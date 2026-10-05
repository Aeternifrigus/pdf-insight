import type { z } from 'zod';
import { chunkPages, type Chunk } from '../../src/lib/chunk';
import { detectInjection, injectionWarnings } from '../../src/lib/injection';
import { dedupeStrings, mergeLists } from '../../src/lib/merge';
import {
  formatIssues,
  insightSchema,
  modelOutputSchema,
  reduceOutputSchema,
  type AnalyzeRequest,
  type Insight,
  type ModelOutput,
} from '../../src/lib/schema';
import { AppError, ProviderError } from './errors';
import type { LlmClient, LlmImage, Turn } from './llm';
import {
  documentBlock,
  newNonce,
  reducePrompt,
  reduceSystemPrompt,
  retryPrompt,
  systemPrompt,
} from './prompt';

export const CHUNK_CHARS = 60_000;
export const MAX_CHUNKS = 8;
const CONCURRENCY = 3;

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

/**
 * Drobna normalizacja formatu (nie treści): wielkość liter kodów,
 * symbole walut, liczby zapisane jako tekst, puste napisy → null.
 */
export function normalizeModelJson(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const o = structuredClone(input) as Record<string, unknown>;

  const doc = o.document as Record<string, unknown> | undefined;
  if (doc && typeof doc === 'object') {
    if (typeof doc.language === 'string')
      doc.language = doc.language.trim().toLowerCase().slice(0, 2);
    if (typeof doc.type === 'string') doc.type = doc.type.trim().toLowerCase();
    for (const k of ['title', 'date'] as const) {
      if (typeof doc[k] === 'string' && doc[k].trim() === '') doc[k] = null;
      if (doc[k] === undefined) doc[k] = null;
    }
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
        const n = Number(amt.value.replace(/\s/g, '').replace(',', '.'));
        if (Number.isFinite(n)) amt.value = n;
      }
      return amt;
    });
  }

  for (const k of ['keyPoints', 'keywords', 'warnings'] as const) {
    if (o[k] === undefined || o[k] === null) o[k] = [];
  }
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
export async function callValidated<S extends z.ZodType>(
  llm: LlmClient,
  system: string,
  userTurn: Turn,
  schema: S,
): Promise<z.infer<S>> {
  const turns: Turn[] = [userTurn];
  let lastIssues: string[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: string;
    try {
      raw = await llm.complete(system, turns);
    } catch (e) {
      if (e instanceof ProviderError) {
        if (e.status === 429) {
          throw new AppError(
            'AI_RATE_LIMITED',
            503,
            'Przekroczono limit zapytań do dostawcy AI. Spróbuj ponownie za minutę.',
          );
        }
        if (attempt === 0 && (e.status >= 500 || e.status === 504)) continue;
        throw new AppError('AI_UNAVAILABLE', 502, 'Usługa AI jest chwilowo niedostępna.', [
          e.message,
        ]);
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
      documentBlock(nonce, { fileName: req.fileName, pageCount: req.pageCount }, chunk, part) +
      note,
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

  const nonce = newNonce();
  const system = systemPrompt(nonce);
  const meta = { fileName: req.fileName, pageCount: req.pageCount };

  let core: Pick<ModelOutput, 'document' | 'summary' | 'keyPoints'>;
  let lists: ReturnType<typeof mergeLists>;

  if (chunks.length === 1) {
    const out = await callValidated(
      llm,
      system,
      chunkTurn(nonce, req, chunks[0] as Chunk, req.images),
      modelOutputSchema,
    );
    core = out;
    lists = mergeLists([out]);
  } else {
    const parts = await mapLimited(chunks, CONCURRENCY, (chunk, index) =>
      callValidated(
        llm,
        system,
        chunkTurn(nonce, req, chunk, req.images, { index, total: chunks.length }),
        modelOutputSchema,
      ),
    );
    const reduceNonce = newNonce();
    core = await callValidated(
      llm,
      reduceSystemPrompt(reduceNonce),
      { role: 'user', text: reducePrompt(reduceNonce, meta, parts) },
      reduceOutputSchema,
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
