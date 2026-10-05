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

export function isApiConfigured(): boolean {
  return API_URL.length > 0;
}

export function buildRequest(fileName: string, pdf: ExtractedPdf): AnalyzeRequest {
  return { fileName, pageCount: pdf.pageCount, pages: pdf.pages, images: pdf.images };
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

  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.any([signal, timeout]),
    });
  } catch (e) {
    if (signal.aborted) throw e;
    if (timeout.aborted) throw new ApiError('Analiza trwała zbyt długo. Spróbuj ponownie.');
    throw new ApiError('Brak połączenia z serwerem analizy. Sprawdź internet i spróbuj ponownie.');
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(`Serwer zwrócił nieczytelną odpowiedź (HTTP ${res.status}).`);
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
