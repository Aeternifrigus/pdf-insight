import type { z } from 'zod';
import { chunkPages, type Chunk } from '../../src/lib/chunk';
import { detectInjection, injectionWarnings } from '../../src/lib/injection';
import { dedupeStrings, mergeLists } from '../../src/lib/merge';
import {
  formatIssues,
  insightSchema,
  modelOutputSchema,
  partialOutputSchema,
  reduceOutputSchema,
  type AnalyzeRequest,
  type Insight,
  type ModelOutput,
} from '../../src/lib/schema';
import { AppError, ProviderError, TruncatedResponseError } from './errors';
import type { LlmClient, LlmImage, Turn } from './llm';
import {
  documentBlock,
  newNonce,
  reducePrompt,
  reduceSystemPrompt,
  retryPrompt,
  systemPrompt,
  truncatedRetryPrompt,
} from './prompt';

/**
 * Duże fragmenty (ok. 40 tys. tokenów, model ma okno 1 mln) oznaczają mało wywołań:
 * dokument z limitem 400 tys. znaków to maks. 3 fragmenty + 1 wywołanie łączące,
 * co mieści się w darmowym limicie ok. 10 zapytań na minutę.
 */
export const CHUNK_CHARS = 150_000;
export const MAX_CHUNKS = 4;
const CONCURRENCY = 2;
/** Najdłuższe oczekiwanie na zwolnienie limitu dostawcy (HTTP 429) przed jedną ponowną próbą. */
const MAX_RATE_LIMIT_WAIT_MS = 15_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wyciąga obiekt JSON z odpowiedzi modelu (toleruje bloki ```json). */
export function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('Odpowiedź nie zawiera obiektu JSON');
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

const CURRENCY_ALIASES: Record<string, string> = {
  ZŁ: 'PLN',
  ZL: 'PLN',
  ZŁOTY: 'PLN',
  '€': 'EUR',
  EURO: 'EUR',
  $: 'USD',
  US$: 'USD',
  '£': 'GBP',
};

const TYPE_ALIASES: Record<string, string> = {
  invoice: 'faktura',
  contract: 'umowa',
  agreement: 'umowa',
  offer: 'oferta',
  quote: 'oferta',
  quotation: 'oferta',
  report: 'raport',
  other: 'inne',
};

/** Tag BCP 47 ("pl-PL", "en_US") → kod ISO 639-1. Inne wartości zostają bez zmian (walidacja je odrzuci). */
export function normalizeLanguage(value: string): string {
  const v = value.trim();
  const m = /^([a-z]{2})(?:[-_][a-z0-9]+)*$/i.exec(v);
  return m?.[1] ? m[1].toLowerCase() : v;
}

/** "2026-03-12T00:00:00Z" → "2026-03-12". Inne formaty zostają bez zmian. */
export function normalizeDate(value: string): string {
  const v = value.trim();
  return /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?$/.test(v) ? v.slice(0, 10) : v;
}

/**
 * Liczba zapisana jako tekst, tylko gdy zapis jest jednoznaczny:
 * "184 500,00", "184500.5", "1,5". Zapis "12,345" może oznaczać 12 345 albo 12,345,
 * więc zostaje bez zmian i trafia do ponownej próby zamiast cichej pomyłki o 1000×.
 */
export function parseUnambiguousNumber(value: string): number | null {
  const v = value.replace(/[\s\u00a0]/g, '');
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^-?\d+,\d{1,2}$/.test(v)) return Number(v.replace(',', '.'));
  return null;
}

/**
 * Drobna normalizacja formatu (nie treści): wielkość liter kodów,
 * symbole walut, liczby zapisane jako tekst, puste napisy → null.
 */
export function normalizeModelJson(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const o = structuredClone(input) as Record<string, unknown>;

  const doc = o.document as Record<string, unknown> | undefined;
  if (doc && typeof doc === 'object') {
    if (typeof doc.language === 'string') doc.language = normalizeLanguage(doc.language);
    if (typeof doc.type === 'string') {
      const t = doc.type.trim().toLowerCase();
      doc.type = TYPE_ALIASES[t] ?? t;
    }
    for (const k of ['title', 'date'] as const) {
      if (typeof doc[k] === 'string' && doc[k].trim() === '') doc[k] = null;
      if (doc[k] === undefined) doc[k] = null;
    }
    if (typeof doc.date === 'string') doc.date = normalizeDate(doc.date);
  }

  if (Array.isArray(o.amounts)) {
    o.amounts = o.amounts.map((a: unknown) => {
      if (!a || typeof a !== 'object') return a;
      const amt = { ...(a as Record<string, unknown>) };
      if (typeof amt.currency === 'string') {
        const c = amt.currency.trim().toUpperCase();
        amt.currency = CURRENCY_ALIASES[c] ?? c;
      }
      if (typeof amt.value === 'string') {
        const n = parseUnambiguousNumber(amt.value);
        if (n !== null) amt.value = n;
      }
      return amt;
    });
  }

  if (Array.isArray(o.dates)) {
    o.dates = o.dates.map((d: unknown) => {
      if (!d || typeof d !== 'object') return d;
      const entry = { ...(d as Record<string, unknown>) };
      if (typeof entry.date === 'string') entry.date = normalizeDate(entry.date);
      return entry;
    });
  }

  for (const k of ['keyPoints', 'keywords', 'warnings'] as const) {
    if (o[k] === undefined || o[k] === null) o[k] = [];
  }
  // Nadmiar punktów nie jest błędem treści: zostawiamy pierwsze (model podaje je od najważniejszych),
  // zamiast odrzucać całą analizę i zużywać ponowną próbę.
  if (Array.isArray(o.keyPoints) && o.keyPoints.length > 7) o.keyPoints = o.keyPoints.slice(0, 7);
  if (Array.isArray(o.keywords) && o.keywords.length > 15) o.keywords = o.keywords.slice(0, 15);
  for (const k of ['amounts', 'dates'] as const) {
    if (o[k] === undefined || o[k] === null) o[k] = [];
  }
  if (o.entities === undefined || o.entities === null) o.entities = {};
  const ent = o.entities as Record<string, unknown>;
  if (typeof ent === 'object') {
    ent.organizations ??= [];
    ent.people ??= [];
  }
  return o;
}

/**
 * Wywołanie modelu z walidacją. Zgodnie z briefem: przy błędnej odpowiedzi
 * jest dokładnie 1 ponowna próba (z listą błędów), potem błąd.
 */
/** Łączny budżet czasu analizy; klient czeka maks. 120 s, więc backend kończy wcześniej. */
export const ANALYSIS_BUDGET_MS = 100_000;
/** Minimalny czas potrzebny na sensowne wywołanie modelu. */
const MIN_CALL_MS = 8_000;

export async function callValidated<S extends z.ZodType>(
  llm: LlmClient,
  system: string,
  userTurn: Turn,
  schema: S,
  deadline = Date.now() + ANALYSIS_BUDGET_MS,
): Promise<z.infer<S>> {
  const turns: Turn[] = [userTurn];
  let lastIssues: string[] = [];
  let rateLimitRetried = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    // Bez tego przy długich dokumentach backend pracowałby (i zużywał limit API)
    // jeszcze długo po tym, jak przeglądarka przestała czekać.
    if (deadline - Date.now() < MIN_CALL_MS) {
      throw new AppError('AI_TIMEOUT', 504, 'Analiza trwała zbyt długo. Spróbuj krótszego pliku.');
    }
    let raw: string;
    try {
      raw = await llm.complete(system, turns);
    } catch (e) {
      if (e instanceof TruncatedResponseError) {
        // Ucięty JSON: zamiast ogólnego "popraw błędy" prosimy wprost o krótszą odpowiedź.
        lastIssues = ['(root): the answer was cut off because it was too long'];
        turns.push(
          { role: 'model', text: e.partial.slice(0, 20_000) },
          { role: 'user', text: truncatedRetryPrompt() },
        );
        continue;
      }
      if (e instanceof ProviderError) {
        if (e.status === 422) {
          throw new AppError(
            'AI_REFUSED',
            422,
            'Dostawca AI odmówił analizy tego dokumentu (filtr treści). Spróbuj innego pliku.',
          );
        }
        if (e.status === 429) {
          // Jedno krótkie odczekanie, jeśli dostawca podał czas i mieści się w budżecie.
          const wait = e.retryAfterMs ?? 5_000;
          const fits = Date.now() + wait + MIN_CALL_MS < deadline;
          if (!rateLimitRetried && wait <= MAX_RATE_LIMIT_WAIT_MS && fits) {
            rateLimitRetried = true;
            await sleep(wait);
            attempt--;
            continue;
          }
          throw new AppError(
            'AI_RATE_LIMITED',
            503,
            'Przekroczono limit zapytań do dostawcy AI. Spróbuj ponownie za minutę.',
          );
        }
        // Szczegóły od dostawcy trafiają tylko do logów Workera, nie do klienta.
        console.error('LLM provider error', e.status, e.message);
        if ([400, 401, 403, 404].includes(e.status)) {
          throw new AppError(
            'MISCONFIGURED',
            500,
            'Backend ma nieprawidłową konfigurację dostawcy AI (klucz lub model).',
          );
        }
        if (attempt === 0 && e.status >= 500) continue;
        throw new AppError('AI_UNAVAILABLE', 502, 'Usługa AI jest chwilowo niedostępna.');
      }
      throw e;
    }

    let parsed: unknown;
    try {
      parsed = normalizeModelJson(extractJson(raw));
    } catch (e) {
      lastIssues = [`(root): ${(e as Error).message}`];
      turns.push(
        { role: 'model', text: raw.slice(0, 20_000) },
        { role: 'user', text: retryPrompt(lastIssues) },
      );
      continue;
    }

    const result = schema.safeParse(parsed);
    if (result.success) return result.data;

    lastIssues = formatIssues(result.error);
    turns.push(
      { role: 'model', text: raw.slice(0, 20_000) },
      { role: 'user', text: retryPrompt(lastIssues) },
    );
  }

  throw new AppError(
    'INVALID_AI_RESPONSE',
    502,
    'Model AI zwrócił niepoprawne dane także przy ponownej próbie.',
    lastIssues.slice(0, 10),
  );
}

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Strony zeskanowane (z obrazem) dostają w tekście znacznik, a obraz idzie do fragmentu z tą stroną. */
function preparePages(req: AnalyzeRequest) {
  const imagePages = new Set(req.images.map((i) => i.page));
  return req.pages.map(({ page, text }) => ({
    page,
    text:
      imagePages.has(page) && text.trim().length < 30
        ? `${text}\n(Skan bez warstwy tekstowej: treść tej strony jest na załączonym obrazie "Strona ${page}".)`
        : text,
  }));
}

function imagesFor(chunk: Chunk, images: LlmImage[]): LlmImage[] {
  return images.filter((img) => chunk.pages.includes(img.page));
}

function chunkTurn(
  nonce: string,
  req: AnalyzeRequest,
  chunk: Chunk,
  images: LlmImage[],
  part?: { index: number; total: number },
): Turn {
  const imgs = imagesFor(chunk, images);
  const note = imgs.length
    ? `\n\nAttached images (scanned pages): ${imgs.map((i) => `Strona ${i.page}`).join(', ')}.`
    : '';
  return {
    role: 'user',
    text:
      documentBlock(
        nonce,
        { pageCount: req.pageCount, unreadPages: req.unreadPages },
        chunk,
        part,
      ) + note,
    images: imgs,
  };
}

/**
 * Ostrzeżenia heurystyczne mają pierwszeństwo; ostrzeżenie modelu o tym samym
 * (polecenie dla AI) jest wtedy pomijane, żeby nie dublować komunikatu.
 */
export function combineWarnings(heuristic: string[], fromModel: string[]): string[] {
  const aboutInjection = /\bAI\b|instrukc|polece|prompt/i;
  const model = heuristic.length > 0 ? fromModel.filter((w) => !aboutInjection.test(w)) : fromModel;
  return dedupeStrings([...heuristic, ...model]);
}

export async function analyzeDocument(
  req: AnalyzeRequest,
  llm: LlmClient,
  now: () => Date = () => new Date(),
  budgetMs = ANALYSIS_BUDGET_MS,
): Promise<Insight> {
  const pages = preparePages(req);
  const totalText = pages.reduce((n, p) => n + p.text.trim().length, 0);
  if (totalText === 0 && req.images.length === 0) {
    throw new AppError('BAD_REQUEST', 400, 'Dokument nie zawiera tekstu do analizy.');
  }

  const chunks = chunkPages(pages, CHUNK_CHARS);
  if (chunks.length > MAX_CHUNKS) {
    throw new AppError(
      'PAYLOAD_TOO_LARGE',
      413,
      `Dokument jest zbyt długi (limit to ok. ${(CHUNK_CHARS * MAX_CHUNKS).toLocaleString('pl-PL')} znaków).`,
    );
  }

  const deadline = Date.now() + budgetMs;
  const nonce = newNonce();
  const system = systemPrompt(nonce);
  const meta = { pageCount: req.pageCount, unreadPages: req.unreadPages };

  let core: Pick<ModelOutput, 'document' | 'summary' | 'keyPoints'>;
  let lists: ReturnType<typeof mergeLists>;

  if (chunks.length === 1) {
    const out = await callValidated(
      llm,
      system,
      chunkTurn(nonce, req, chunks[0] as Chunk, req.images),
      modelOutputSchema,
      deadline,
    );
    core = out;
    lists = mergeLists([out]);
  } else {
    const parts = await mapLimited(chunks, CONCURRENCY, (chunk, index) =>
      callValidated(
        llm,
        system,
        chunkTurn(nonce, req, chunk, req.images, { index, total: chunks.length }),
        partialOutputSchema,
        deadline,
      ),
    );
    const reduceNonce = newNonce();
    core = await callValidated(
      llm,
      reduceSystemPrompt(reduceNonce),
      { role: 'user', text: reducePrompt(reduceNonce, meta, parts) },
      reduceOutputSchema,
      deadline,
    );
    lists = mergeLists(parts);
  }

  const heuristic = injectionWarnings(detectInjection(req.pages));
  const insight: Insight = {
    document: { fileName: req.fileName, pages: req.pageCount, ...core.document },
    summary: core.summary,
    keyPoints: core.keyPoints,
    entities: lists.entities,
    amounts: lists.amounts,
    dates: lists.dates,
    keywords: lists.keywords,
    analysis: {
      model: llm.model,
      createdAt: now().toISOString(),
      chunks: chunks.length,
      ocrPages: req.images.map((i) => i.page).sort((a, b) => a - b),
      unreadPages: req.unreadPages,
      warnings: combineWarnings(heuristic, lists.warnings),
    },
  };

  // Ostatnia kontrola całości przed wysłaniem do klienta.
  const final = insightSchema.safeParse(insight);
  if (!final.success) {
    throw new AppError(
      'INVALID_AI_RESPONSE',
      502,
      'Wynik analizy nie przeszedł walidacji.',
      formatIssues(final.error),
    );
  }
  return final.data;
}
