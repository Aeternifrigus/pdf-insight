import type { z } from 'zod';
import type { ExtractedPdf } from '../lib/pdf';
import {
  formatIssues,
  insightSchema,
  translateDocumentResponseSchema,
  type AnalyzeRequest,
  type Insight,
  type OutputLanguage,
  type TranslateDocumentRequest,
  type TranslateDocumentResponse,
} from '../lib/schema';

const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
const TIMEOUT_MS = 120_000;

/**
 * Błąd API z kodem. Interfejs pokazuje komunikat dla kodu w wybranym języku,
 * a `message` (tekst z serwera, po polsku) jest tylko zapasowy.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: string[] = [],
    public readonly retryable = true,
    public readonly retryAfterSeconds?: number,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Łączy sygnał anulowania z limitem czasu. AbortSignal.any jest dostępne dopiero
 * od Safari 17.4, więc na starszych iPhone'ach każda analiza kończyłaby się błędem.
 */
export function withTimeout(
  signal: AbortSignal,
  ms: number,
): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, ms);
  const onAbort = () => {
    ctrl.abort();
  };
  if (signal.aborted) ctrl.abort();
  else signal.addEventListener('abort', onAbort, { once: true });
  return {
    signal: ctrl.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    },
  };
}

export function isApiConfigured(): boolean {
  return API_URL.length > 0;
}

export function buildRequest(fileName: string, pdf: ExtractedPdf): AnalyzeRequest {
  return {
    fileName,
    pageCount: pdf.pageCount,
    pages: pdf.pages,
    images: pdf.images,
    unreadPages: pdf.unreadPages,
  };
}

interface ErrorBody {
  error?: { code?: unknown; message?: unknown; details?: unknown; retryAfterSeconds?: unknown };
}

/** Wspólne wywołanie API: limit czasu, kody błędów i walidacja odpowiedzi schematem. */
async function post<S extends z.ZodType>(
  path: string,
  payload: unknown,
  schema: S,
  signal: AbortSignal,
): Promise<z.infer<S>> {
  if (!isApiConfigured()) {
    throw new ApiError('NO_API_URL', 'Brak adresu backendu (VITE_API_URL).', [], false);
  }

  const combined = withTimeout(signal, TIMEOUT_MS);
  let res: Response;
  let body: unknown;
  try {
    try {
      res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: combined.signal,
      });
    } catch (e) {
      if (signal.aborted) throw e;
      if (combined.timedOut()) throw new ApiError('TIMEOUT', 'Przekroczono limit czasu.');
      throw new ApiError('NETWORK', 'Brak połączenia z serwerem.');
    }
    try {
      body = await res.json();
    } catch {
      if (signal.aborted) throw new DOMException('Anulowano', 'AbortError');
      throw new ApiError(
        'BAD_RESPONSE',
        `HTTP ${String(res.status)}`,
        [],
        true,
        undefined,
        res.status,
      );
    }
  } finally {
    combined.dispose();
  }

  if (!res.ok) {
    const err = (body as ErrorBody).error;
    const code = typeof err?.code === 'string' ? err.code : 'BAD_RESPONSE';
    const message = typeof err?.message === 'string' ? err.message : `HTTP ${String(res.status)}`;
    const details = Array.isArray(err?.details)
      ? err.details.filter((d): d is string => typeof d === 'string')
      : [];
    const retryAfter =
      typeof err?.retryAfterSeconds === 'number' ? err.retryAfterSeconds : undefined;
    // 400, 413 i 422 (filtr treści) dadzą ten sam wynik przy ponowieniu.
    const retryable = ![400, 413, 422].includes(res.status);
    throw new ApiError(code, message, details, retryable, retryAfter, res.status);
  }

  // Walidacja przed wyświetleniem: frontend nie ufa ślepo backendowi.
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError('SCHEMA', 'Niezgodny schemat odpowiedzi.', formatIssues(parsed.error));
  }
  return parsed.data;
}

export function analyze(request: AnalyzeRequest, signal: AbortSignal): Promise<Insight> {
  return post('/analyze', request, insightSchema, signal);
}

/** Tłumaczenie wyniku. Odpowiedź musi być tłumaczeniem na żądany język tego samego wyniku. */
export async function translate(
  insight: Insight,
  target: OutputLanguage,
  signal: AbortSignal,
): Promise<Insight> {
  const out = await post('/translate', { insight, target }, insightSchema, signal);
  if (out.analysis.translation?.to !== target) {
    throw new ApiError('SCHEMA', 'Odpowiedź nie jest tłumaczeniem na żądany język.');
  }
  return out;
}

export function translateDocumentChunk(
  request: TranslateDocumentRequest,
  signal: AbortSignal,
): Promise<TranslateDocumentResponse> {
  return post('/translate-document', request, translateDocumentResponseSchema, signal);
}
