import { analyzeRequestSchema, formatIssues } from '../../src/lib/schema';
import { analyzeDocument } from './analyze';
import type { Env } from './env';
import { AppError } from './errors';
import { corsHeaders, errorResponse, json, parseAllowedOrigins, readBodyLimited } from './http';
import { createLlm } from './llm';
import { isAllowed } from './rateLimit';

/** Tekst (maks. 400 tys. znaków, do ok. 1 MB w UTF-8) + do 4 obrazów po maks. 600 tys. znaków base64. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  const cors = corsHeaders(origin, allowed);

  try {
    // Żądania z przeglądarki spoza dozwolonych domen są odrzucane od razu.
    if (origin && !allowed.includes(origin)) {
      throw new AppError('FORBIDDEN_ORIGIN', 403, 'Ta domena nie ma dostępu do API.');
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === '/health' && request.method === 'GET') {
      return json({ ok: true }, 200, cors);
    }

    if (url.pathname !== '/analyze') {
      throw new AppError('NOT_FOUND', 404, 'Nie znaleziono.');
    }
    if (request.method !== 'POST') {
      throw new AppError('METHOD_NOT_ALLOWED', 405, 'Dozwolona jest tylko metoda POST.');
    }
    if (!origin) {
      // API jest przeznaczone dla aplikacji w przeglądarce.
      throw new AppError('FORBIDDEN_ORIGIN', 403, 'Brak nagłówka Origin.');
    }
    if (!(request.headers.get('Content-Type') ?? '').includes('application/json')) {
      throw new AppError('BAD_REQUEST', 415, 'Oczekiwano treści JSON.');
    }

    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (!(await isAllowed(env, ip))) {
      throw new AppError(
        'RATE_LIMITED',
        429,
        'Za dużo analiz w krótkim czasie. Odczekaj minutę i spróbuj ponownie.',
      );
    }

    const raw = await readBodyLimited(request, MAX_BODY_BYTES);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new AppError('BAD_REQUEST', 400, 'Nieprawidłowy format żądania.');
    }
    const parsed = analyzeRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        'BAD_REQUEST',
        400,
        'Nieprawidłowe dane żądania.',
        formatIssues(parsed.error),
      );
    }

    const llm = createLlm(env);
    const insight = await analyzeDocument(parsed.data, llm);
    return json(insight, 200, cors);
  } catch (e) {
    if (e instanceof AppError) {
      const extra: Record<string, string> = { ...cors };
      if (e.status === 429 || e.code === 'AI_RATE_LIMITED') extra['Retry-After'] = '60';
      return errorResponse(e, extra);
    }
    // Szczegóły błędu trafiają tylko do logów Workera, nie do klienta.
    console.error('Unhandled error', e);
    return errorResponse(
      new AppError('INTERNAL', 500, 'Wystąpił nieoczekiwany błąd serwera.'),
      cors,
    );
  }
}
