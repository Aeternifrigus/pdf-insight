import type { ExtractedPdf } from '../lib/pdf';
import { formatIssues, insightSchema, type AnalyzeRequest, type Insight } from '../lib/schema';

const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
const TIMEOUT_MS = 120_000;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly details: string[] = [],
    public readonly retryable = true,
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
  error?: { message?: unknown; details?: unknown };
}

export async function analyze(request: AnalyzeRequest, signal: AbortSignal): Promise<Insight> {
  if (!isApiConfigured()) {
    throw new ApiError(
      'Brak adresu backendu (VITE_API_URL). Aplikacja jest źle skonfigurowana.',
      [],
      false,
    );
  }

  const combined = withTimeout(signal, TIMEOUT_MS);
  let res: Response;
  let body: unknown;
  try {
    try {
      res = await fetch(`${API_URL}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: combined.signal,
      });
    } catch (e) {
      if (signal.aborted) throw e;
      if (combined.timedOut()) throw new ApiError('Analiza trwała zbyt długo. Spróbuj ponownie.');
      throw new ApiError(
        'Brak połączenia z serwerem analizy. Sprawdź internet i spróbuj ponownie.',
      );
    }
    try {
      body = await res.json();
    } catch {
      if (signal.aborted) throw new DOMException('Anulowano', 'AbortError');
      throw new ApiError(`Serwer zwrócił nieczytelną odpowiedź (HTTP ${res.status}).`);
    }
  } finally {
    combined.dispose();
  }

  if (!res.ok) {
    const err = (body as ErrorBody).error;
    const message =
      typeof err?.message === 'string'
        ? err.message
        : `Analiza nie powiodła się (HTTP ${res.status}).`;
    const details = Array.isArray(err?.details)
      ? err.details.filter((d): d is string => typeof d === 'string')
      : [];
    throw new ApiError(message, details, res.status !== 400 && res.status !== 413);
  }

  // Walidacja przed wyświetleniem: frontend nie ufa ślepo backendowi.
  const parsed = insightSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      'Wynik analizy nie jest zgodny ze schematem danych.',
      formatIssues(parsed.error),
    );
  }
  return parsed.data;
}
