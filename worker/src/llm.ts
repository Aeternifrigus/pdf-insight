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
}

type FetchFn = typeof fetch;

export const CALL_TIMEOUT_MS = 45_000;

export function createLlm(env: Env, fetchFn: FetchFn = fetch): LlmClient {
  const provider = (env.LLM_PROVIDER ?? 'gemini').toLowerCase();
  if (provider === 'gemini') {
    if (!env.GEMINI_API_KEY) throw misconfigured('GEMINI_API_KEY');
    return new GeminiClient(
      env.GEMINI_API_KEY,
      geminiModels(env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODELS),
      fetchFn,
    );
  }
  if (provider === 'openai') {
    if (!env.OPENAI_API_KEY) throw misconfigured('OPENAI_API_KEY');
    return new OpenAiCompatibleClient(
      env.OPENAI_API_KEY,
      (env.OPENAI_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, ''),
      env.OPENAI_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct',
      fetchFn,
    );
  }
  throw new AppError('MISCONFIGURED', 500, 'Serwer ma nieprawidłową konfigurację dostawcy AI.');
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

class GeminiClient implements LlmClient {
  private current = 0;

  constructor(
    private readonly apiKey: string,
    private readonly models: string[],
    private readonly fetchFn: FetchFn,
  ) {}

  /** Model, który ostatnio odpowiedział (trafia do analysis.model w wyniku). */
  get model(): string {
    return this.models[this.current] ?? DEFAULT_GEMINI_MODEL;
  }

  /**
   * Próbuje modeli po kolei. Po udanym przełączeniu kolejne wywołania w tym samym żądaniu
   * (ponowna próba, części długiego dokumentu) od razu używają działającego modelu.
   */
  async complete(system: string, turns: Turn[], options: CallOptions = {}): Promise<string> {
    const deadline = Date.now() + Math.min(options.timeoutMs ?? CALL_TIMEOUT_MS, CALL_TIMEOUT_MS);
    for (;;) {
      try {
        return await this.completeWith(this.model, system, turns, {
          ...options,
          timeoutMs: Math.max(1, deadline - Date.now()),
        });
      } catch (e) {
        const hasNext = this.current + 1 < this.models.length;
        if (!hasNext || !isModelSpecificFailure(e) || deadline - Date.now() < MIN_FALLBACK_MS) {
          throw e;
        }
        console.warn('Gemini fallback', this.model, '->', this.models[this.current + 1]);
        this.current++;
      }
    }
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
      maxOutputTokens: options.maxOutputTokens ?? 12_288,
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
        max_tokens: options.maxOutputTokens ?? 12_288,
        response_format: { type: 'json_object' },
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
