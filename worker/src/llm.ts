import type { Env } from './env';
import { AppError, ProviderError, TruncatedResponseError } from './errors';

export interface LlmImage {
  page: number;
  mimeType: string;
  data: string;
}

export interface Turn {
  role: 'user' | 'model';
  text: string;
  images?: LlmImage[];
}

export interface CallOptions {
  /** Pozwala skrócić wywołanie do pozostałego budżetu czasu analizy. */
  timeoutMs?: number;
  /** Tłumaczenie całego dokumentu potrzebuje dłuższej odpowiedzi niż analiza. */
  maxOutputTokens?: number;
}

export interface LlmClient {
  readonly model: string;
  complete(system: string, turns: Turn[], options?: CallOptions): Promise<string>;
  /** Wraca do modelu głównego (np. po odczekaniu limitu zapytań). */
  reset?(): void;
}

type FetchFn = typeof fetch;

export const CALL_TIMEOUT_MS = 45_000;

export function createLlm(env: Env, fetchFn: FetchFn = fetch): LlmClient {
  const provider = (env.LLM_PROVIDER ?? 'gemini').toLowerCase();
  if (provider === 'gemini') {
    if (!env.GEMINI_API_KEY) throw misconfigured('GEMINI_API_KEY');
    const gemini = new GeminiClient(
      env.GEMINI_API_KEY,
      geminiModels(env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODELS),
      fetchFn,
    );
    // Zapasowi dostawcy z osobnymi darmowymi limitami, włączani samą konfiguracją:
    // Groq (sekret OPENAI_API_KEY) i Cloudflare Workers AI (binding AI w wrangler.toml).
    const backups: LlmClient[] = [];
    if (env.OPENAI_API_KEY) backups.push(openAiClient(env, fetchFn));
    if (env.AI && env.WORKERS_AI_MODEL) backups.push(workersAiClient(env));
    return backups.length > 0 ? new ChainClient([gemini, ...backups]) : gemini;
  }
  if (provider === 'openai') return openAiClient(env, fetchFn);
  if (provider === 'workers-ai') return workersAiClient(env);
  throw new AppError('MISCONFIGURED', 500, 'Serwer ma nieprawidłową konfigurację dostawcy AI.');
}

function workersAiClient(env: Env): LlmClient {
  if (!env.AI) {
    throw new AppError('MISCONFIGURED', 500, 'Serwer nie ma bindingu Workers AI (AI).');
  }
  const maxTokens = Number(env.WORKERS_AI_MAX_TOKENS);
  return new WorkersAiClient(
    env.AI,
    env.WORKERS_AI_MODEL || '@cf/meta/llama-4-scout-17b-16e-instruct',
    Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 8_192,
  );
}

function openAiClient(env: Env, fetchFn: FetchFn): LlmClient {
  if (!env.OPENAI_API_KEY) throw misconfigured('OPENAI_API_KEY');
  const maxTokens = Number(env.OPENAI_MAX_TOKENS);
  return new OpenAiCompatibleClient(
    env.OPENAI_API_KEY,
    (env.OPENAI_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, ''),
    env.OPENAI_MODEL || 'qwen/qwen3.8-27b',
    fetchFn,
    Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 8_192,
    {
      reasoning_format: env.OPENAI_REASONING_FORMAT || undefined,
      reasoning_effort: env.OPENAI_REASONING_EFFORT || undefined,
    },
  );
}

function misconfigured(name: string): AppError {
  return new AppError('MISCONFIGURED', 500, `Serwer nie ma skonfigurowanego klucza API (${name}).`);
}

async function postJson(
  fetchFn: FetchFn,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, CALL_TIMEOUT_MS))),
    });
  } catch (e) {
    throw new ProviderError(504, `Brak odpowiedzi dostawcy AI: ${(e as Error).name}`);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 2000);
    throw new ProviderError(
      res.status,
      `Dostawca AI zwrócił HTTP ${res.status}: ${detail.slice(0, 300)}`,
      res.status === 429 ? parseRetryAfter(res.headers.get('Retry-After'), detail) : null,
    );
  }
  return res.json();
}

/** Czas oczekiwania z nagłówka Retry-After (sekundy) albo z RetryInfo Gemini ("retryDelay": "7s"). */
export function parseRetryAfter(header: string | null, body: string): number | null {
  const fromHeader = header ? Number(header) : NaN;
  if (Number.isFinite(fromHeader) && fromHeader >= 0) return fromHeader * 1000;
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  return m?.[1] ? Number(m[1]) * 1000 : null;
}

const BLOCK_REASONS = new Set([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY',
  'LANGUAGE',
]);

/**
 * Domyślny model. `gemini-2.5-flash` jest od 2026 r. dostępny tylko dla projektów, które już go
 * używały, więc nowy klucz API dostawał błąd. Aktualne modele Flash mają darmowy plan i obsługują
 * obrazy (odczyt skanów). Model można zmienić zmienną GEMINI_MODEL bez zmiany kodu.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

/**
 * Ustawienie „myślenia” modelu, krótsze odpowiedzi = mieszczenie się w 30 s z briefu.
 * Gemini 2.5: thinkingBudget (0 wyłącza). Gemini 3: thinkingLevel (najniższy to "low").
 */
export function thinkingConfigFor(model: string): Record<string, unknown> | null {
  if (/^gemini-2\.5-flash/.test(model)) return { thinkingBudget: 0 };
  if (/^gemini-3/.test(model)) return { thinkingLevel: 'low' };
  return null;
}

/** Model główny i zapasowe (lista po przecinku), bez duplikatów. */
export function geminiModels(primary?: string, fallbacks?: string): string[] {
  const list = [primary || DEFAULT_GEMINI_MODEL, ...(fallbacks ?? '').split(',')]
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set(list)];
}

/**
 * Błędy, przy których warto spróbować innego modelu: przeciążenie (503 „high demand”),
 * inne błędy serwera, brak odpowiedzi oraz wyczerpany limit (w darmowym planie liczony
 * osobno dla każdego modelu), a także 404, gdy model nie jest dostępny dla danego klucza.
 * Błędy klucza (401, 403), żądania (400) i filtrów treści (422) nie zależą od modelu.
 */
export function isModelSpecificFailure(e: unknown): boolean {
  return e instanceof ProviderError && (e.status === 404 || e.status === 429 || e.status >= 500);
}

/** Bez wystarczającego czasu nie ma sensu pytać kolejnego modelu. */
const MIN_FALLBACK_MS = 5_000;

/**
 * Limit czasu jednej próby, gdy jest jeszcze model zapasowy. Przeciążony model potrafi też
 * odpowiadać bardzo wolno; bez limitu zużyłby cały budżet i do modelu zapasowego nie doszłoby.
 * Długie odpowiedzi (tłumaczenie całych stron) dostają pełny czas.
 */
const PER_MODEL_MS = 25_000;
/** Czas zostawiany zapasowemu dostawcy w łańcuchu (ChainClient). */
const BACKUP_RESERVE_MS = 20_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 12_288;

/**
 * Przy wyczerpaniu listy zgłaszamy najbardziej użyteczny błąd: limit (429) lub przeciążenie (5xx)
 * mówi użytkownikowi „spróbuj za chwilę”, a 404 czy zły klucz zapasowego dostawcy by to zasłoniły.
 */
function moreUseful(a: unknown, b: unknown): unknown {
  const rank = (e: unknown) =>
    e instanceof ProviderError ? (e.status === 429 ? 3 : e.status >= 500 ? 2 : 1) : 0;
  return rank(b) >= rank(a) ? b : a;
}

class GeminiClient implements LlmClient {
  /** Pierwszy model do wypróbowania; po udanym przełączeniu kolejne wywołania zaczynają od niego. */
  private start = 0;
  private answered: string;

  constructor(
    private readonly apiKey: string,
    private readonly models: string[],
    private readonly fetchFn: FetchFn,
  ) {
    this.answered = models[0] ?? DEFAULT_GEMINI_MODEL;
  }

  /** Model, który faktycznie odpowiedział (trafia do analysis.model w wyniku). */
  get model(): string {
    return this.answered;
  }

  /**
   * Próbuje modeli po kolei w ramach jednego budżetu czasu. Indeks jest lokalny, więc dwa
   * równoległe wywołania (części długiego dokumentu) nie przeskakują sobie nawzajem modeli.
   */
  async complete(system: string, turns: Turn[], options: CallOptions = {}): Promise<string> {
    const deadline = Date.now() + Math.min(options.timeoutMs ?? CALL_TIMEOUT_MS, CALL_TIMEOUT_MS);
    const longOutput =
      (options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS) > DEFAULT_MAX_OUTPUT_TOKENS;
    let idx = this.start;
    let worst: unknown = null;
    for (;;) {
      const model = this.models[idx] ?? DEFAULT_GEMINI_MODEL;
      const hasNext = idx + 1 < this.models.length;
      const remaining = deadline - Date.now();
      const timeoutMs = hasNext && !longOutput ? Math.min(remaining, PER_MODEL_MS) : remaining;
      try {
        const text = await this.completeWith(model, system, turns, {
          ...options,
          timeoutMs: Math.max(1, timeoutMs),
        });
        this.start = idx;
        this.answered = model;
        return text;
      } catch (e) {
        if (!isModelSpecificFailure(e)) throw e;
        worst = moreUseful(worst, e);
        if (!hasNext || deadline - Date.now() < MIN_FALLBACK_MS) throw worst;
        console.warn('Gemini fallback', model, '->', this.models[idx + 1]);
        idx++;
      }
    }
  }

  /** Po odczekaniu limitu model główny znowu ma szansę (limit minutowy mógł się odnowić). */
  reset(): void {
    this.start = 0;
  }

  private async completeWith(
    model: string,
    system: string,
    turns: Turn[],
    options: CallOptions,
  ): Promise<string> {
    const generationConfig: Record<string, unknown> = {
      responseMimeType: 'application/json',
      temperature: 0.1,
      // Limit obejmuje też tokeny „myślenia” modelu, więc ma zapas ponad samą odpowiedź JSON.
      maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    };
    const thinkingConfig = thinkingConfigFor(model);
    if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig;

    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: turns.map((t) => ({
        role: t.role,
        parts: [
          { text: t.text },
          ...(t.images ?? []).map((img) => ({
            inlineData: { mimeType: img.mimeType, data: img.data },
          })),
        ],
      })),
      generationConfig,
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const data = (await postJson(
      this.fetchFn,
      url,
      { 'x-goog-api-key': this.apiKey },
      body,
      options.timeoutMs,
    )) as {
      candidates?: {
        content?: { parts?: { text?: string; thought?: boolean }[] };
        finishReason?: string;
      }[];
      promptFeedback?: { blockReason?: string };
    };

    if (data.promptFeedback?.blockReason) {
      throw new ProviderError(
        422,
        `Dostawca AI odrzucił dokument (${data.promptFeedback.blockReason}).`,
      );
    }
    const candidate = data.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join('');
    const reason = candidate?.finishReason ?? '';
    // Filtry treści (np. RECITATION przy cytowaniu opublikowanych tekstów) zwracają pustą odpowiedź.
    // Bez tej obsługi kończyło się to mylącym "niepoprawne dane" po dwóch próbach.
    if (BLOCK_REASONS.has(reason)) {
      throw new ProviderError(422, `Dostawca AI zablokował odpowiedź (${reason}).`);
    }
    if (reason === 'MAX_TOKENS') throw new TruncatedResponseError(text);
    return text;
  }
}

class OpenAiCompatibleClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    readonly model: string,
    private readonly fetchFn: FetchFn,
    /** Górny limit modelu (np. Groq: 8192); większa wartość kończy się błędem 400. */
    private readonly maxTokensCap = 8_192,
    /**
     * Groq, modele z „myśleniem” (np. Qwen): reasoning_effort "none" wyłącza rozumowanie
     * (cały limit tokenów idzie na odpowiedź), reasoning_format "hidden" usuwa je z treści.
     * Inni dostawcy tych pól nie znają, więc są wysyłane tylko, gdy są skonfigurowane.
     */
    private readonly reasoning: { reasoning_format?: string; reasoning_effort?: string } = {},
  ) {}

  async complete(system: string, turns: Turn[], options: CallOptions = {}): Promise<string> {
    const messages = [
      { role: 'system', content: system },
      ...turns.map((t) => {
        const role = t.role === 'model' ? 'assistant' : 'user';
        if (!t.images?.length) return { role, content: t.text };
        return {
          role,
          content: [
            { type: 'text', text: t.text },
            ...t.images.map((img) => ({
              type: 'image_url',
              image_url: { url: `data:${img.mimeType};base64,${img.data}` },
            })),
          ],
        };
      }),
    ];

    const data = (await postJson(
      this.fetchFn,
      `${this.baseUrl}/chat/completions`,
      { Authorization: `Bearer ${this.apiKey}` },
      {
        model: this.model,
        messages,
        temperature: 0.1,
        max_tokens: Math.min(
          options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          this.maxTokensCap,
        ),
        response_format: { type: 'json_object' },
        ...Object.fromEntries(Object.entries(this.reasoning).filter(([, v]) => v)),
      },
      options.timeoutMs,
    )) as { choices?: { message?: { content?: string }; finish_reason?: string }[] };

    const choice = data.choices?.[0];
    const text = choice?.message?.content ?? '';
    if (choice?.finish_reason === 'content_filter') {
      throw new ProviderError(422, 'Dostawca AI zablokował odpowiedź (content_filter).');
    }
    if (choice?.finish_reason === 'length') throw new TruncatedResponseError(text);
    return text;
  }
}

/**
 * Łańcuch niezależnych dostawców (np. Gemini, potem Groq). Każdy ma osobny darmowy limit,
 * więc demo przestaje działać dopiero wtedy, gdy wszystkie są jednocześnie przeciążone
 * lub wyczerpane. Na kolejnego dostawcę przechodzimy przy każdym błędzie dostawcy poza
 * odmową filtra treści (422): zły klucz lub nieobsługiwane żądanie u jednego dostawcy
 * nie musi dotyczyć drugiego.
 */
export class ChainClient implements LlmClient {
  private start = 0;
  private answered: LlmClient;

  constructor(private readonly clients: LlmClient[]) {
    const first = clients[0];
    if (!first) throw new Error('ChainClient wymaga co najmniej jednego klienta');
    this.answered = first;
  }

  get model(): string {
    return this.answered.model;
  }

  async complete(system: string, turns: Turn[], options: CallOptions = {}): Promise<string> {
    const deadline = Date.now() + Math.min(options.timeoutMs ?? CALL_TIMEOUT_MS, CALL_TIMEOUT_MS);
    let worst: unknown = null;
    for (let i = this.start; i < this.clients.length; i++) {
      const client = this.clients[i];
      if (!client) break;
      const hasNext = i + 1 < this.clients.length;
      const remaining = deadline - Date.now();
      // Kolejny dostawca dostaje zarezerwowany czas, inaczej wolny pierwszy zużyłby wszystko.
      const timeoutMs = hasNext
        ? Math.max(remaining - BACKUP_RESERVE_MS, remaining / 2)
        : remaining;
      try {
        const text = await client.complete(system, turns, {
          ...options,
          timeoutMs: Math.max(1, timeoutMs),
        });
        this.start = i;
        this.answered = client;
        return text;
      } catch (e) {
        if (!(e instanceof ProviderError) || e.status === 422) throw e;
        worst = moreUseful(worst, e);
        if (!hasNext || deadline - Date.now() < MIN_FALLBACK_MS) throw worst;
        console.warn('LLM provider fallback', client.model, '->', this.clients[i + 1]?.model);
      }
    }
    throw worst;
  }

  reset(): void {
    this.start = 0;
    for (const c of this.clients) c.reset?.();
  }
}

/** Minimalny interfejs bindingu Workers AI (env.AI) potrzebny klientowi. */
export interface WorkersAiBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

/**
 * Cloudflare Workers AI przez binding: bez klucza API, z dziennym darmowym przydziałem
 * („neurony”) na koncie Cloudflare. Model z obsługą obrazów i długim kontekstem, więc
 * w odróżnieniu od Groq (8000 tokenów na minutę) mieści całą umowę testową.
 */
class WorkersAiClient implements LlmClient {
  constructor(
    private readonly ai: WorkersAiBinding,
    readonly model: string,
    private readonly maxTokensCap: number,
  ) {}

  async complete(system: string, turns: Turn[], options: CallOptions = {}): Promise<string> {
    const messages = [
      { role: 'system', content: system },
      ...turns.map((t) => {
        const role = t.role === 'model' ? 'assistant' : 'user';
        if (!t.images?.length) return { role, content: t.text };
        return {
          role,
          content: [
            { type: 'text', text: t.text },
            ...t.images.map((img) => ({
              type: 'image_url',
              image_url: { url: `data:${img.mimeType};base64,${img.data}` },
            })),
          ],
        };
      }),
    ];
    const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? CALL_TIMEOUT_MS, CALL_TIMEOUT_MS));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new ProviderError(504, 'Brak odpowiedzi Workers AI: TimeoutError'));
      }, timeoutMs);
    });
    let out: unknown;
    try {
      out = await Promise.race([
        this.ai.run(this.model, {
          messages,
          max_tokens: Math.min(
            options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
            this.maxTokensCap,
          ),
          temperature: 0.1,
          response_format: { type: 'json_object' },
        }),
        timeout,
      ]);
    } catch (e) {
      throw workersAiError(e);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    const response = (out as { response?: unknown } | null)?.response;
    // W trybie JSON Workers AI potrafi zwrócić od razu obiekt zamiast tekstu.
    if (response && typeof response === 'object') return JSON.stringify(response);
    return typeof response === 'string' ? response : '';
  }
}

/** Błędy bindingu to zwykłe wyjątki z kodem w treści; zamieniamy je na kody HTTP łańcucha. */
export function workersAiError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  const message = e instanceof Error ? e.message : String(e);
  const detail = `Workers AI: ${message.slice(0, 300)}`;
  if (/neuron|daily|allocation|rate limit|too many|capacity|3036|3040/i.test(message)) {
    return new ProviderError(429, detail);
  }
  if (/no such model|not found|5007/i.test(message)) return new ProviderError(404, detail);
  if (/timeout|timed out/i.test(message)) return new ProviderError(504, detail);
  return new ProviderError(503, detail);
}
