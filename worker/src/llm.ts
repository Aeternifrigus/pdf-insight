import type { Env } from './env';
import { AppError, ProviderError } from './errors';

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

export interface LlmClient {
  readonly model: string;
  complete(system: string, turns: Turn[]): Promise<string>;
}

type FetchFn = typeof fetch;

const CALL_TIMEOUT_MS = 45_000;

export function createLlm(env: Env, fetchFn: FetchFn = fetch): LlmClient {
  const provider = (env.LLM_PROVIDER ?? 'gemini').toLowerCase();
  if (provider === 'gemini') {
    if (!env.GEMINI_API_KEY) throw misconfigured('GEMINI_API_KEY');
    return new GeminiClient(env.GEMINI_API_KEY, env.GEMINI_MODEL || 'gemini-2.5-flash', fetchFn);
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
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (e) {
    throw new ProviderError(504, `Brak odpowiedzi dostawcy AI: ${(e as Error).name}`);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new ProviderError(res.status, `Dostawca AI zwrócił HTTP ${res.status}: ${detail}`);
  }
  return res.json();
}

class GeminiClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetchFn: FetchFn,
  ) {}

  async complete(system: string, turns: Turn[]): Promise<string> {
    const generationConfig: Record<string, unknown> = {
      responseMimeType: 'application/json',
      temperature: 0.1,
      maxOutputTokens: 8192,
    };
    // Gemini 2.5 Flash: wyłączenie "thinking" skraca czas odpowiedzi do kilku sekund.
    if (/^gemini-2\.5-flash/.test(this.model))
      generationConfig.thinkingConfig = { thinkingBudget: 0 };

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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const data = (await postJson(this.fetchFn, url, { 'x-goog-api-key': this.apiKey }, body)) as {
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
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    return parts
      .filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join('');
  }
}

class OpenAiCompatibleClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    readonly model: string,
    private readonly fetchFn: FetchFn,
  ) {}

  async complete(system: string, turns: Turn[]): Promise<string> {
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
        max_tokens: 8192,
        response_format: { type: 'json_object' },
      },
    )) as { choices?: { message?: { content?: string } }[] };

    return data.choices?.[0]?.message?.content ?? '';
  }
}
