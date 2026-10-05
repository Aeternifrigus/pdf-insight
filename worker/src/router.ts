import type { z } from 'zod';
import {
  analyzeRequestSchema,
  formatIssues,
  translateDocumentRequestSchema,
  translateRequestSchema,
} from '../../src/lib/schema';
import { analyzeDocument } from './analyze';
import type { Env } from './env';
import { AppError } from './errors';
import { corsHeaders, errorResponse, json, parseAllowedOrigins, readBodyLimited } from './http';
import { createLlm } from './llm';
import { isAllowed, type LimitScope } from './rateLimit';
import { translateDocumentChunk, translateInsight } from './translate';

/** Tekst (maks. 400 tys. znaków, do ok. 1 MB w UTF-8) + do 4 obrazów po maks. 600 tys. znaków base64. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(
      'BAD_REQUEST',
      400,
      'Nieprawidłowe dane żądania.',
      formatIssues(parsed.error),
    );
  }
  return parsed.data;
}

interface Route {
  scope: LimitScope;
  /** `llm` jest tworzony dopiero po walidacji treści: błędne żądanie ma dostać 400, nie 500. */
  run: (body: unknown, llm: () => ReturnType<typeof createLlm>) => Promise<unknown>;
}

const ROUTES: Record<string, Route | undefined> = {
  '/analyze': {
    scope: 'analyze',
    run: (body, llm) => {
      const req = parse(analyzeRequestSchema, body);
      return analyzeDocument(req, llm());
    },
  },
  '/translate': {
    scope: 'translate',
    run: (body, llm) => {
      const req = parse(translateRequestSchema, body);
      return translateInsight(req.insight, req.target, llm());
    },
  },
  '/translate-document': {
    scope: 'translate',
    run: (body, llm) => {
      const req = parse(translateDocumentRequestSchema, body);
      return translateDocumentChunk(req, llm());
    },
  },
};

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

    const route = ROUTES[url.pathname];
    if (!route) {
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
    if (!(await isAllowed(env, ip, route.scope))) {
      throw new AppError(
        'RATE_LIMITED',
        429,
        'Za dużo zapytań w krótkim czasie. Odczekaj minutę i spróbuj ponownie.',
      );
    }

    const raw = await readBodyLimited(request, MAX_BODY_BYTES);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new AppError('BAD_REQUEST', 400, 'Nieprawidłowy format żądania.');
    }
    const result = await route.run(body, () => createLlm(env));
    return json(result, 200, cors);
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
