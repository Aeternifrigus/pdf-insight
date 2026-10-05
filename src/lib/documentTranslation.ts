import type { ExtractedPdf } from './pdf';
import {
  MAX_TRANSLATE_CHUNK_CHARS,
  MAX_TRANSLATE_CHUNK_IMAGES,
  MAX_TRANSLATE_DOCUMENT_CHARS,
  type NumericIssue,
  type OutputLanguage,
  type TranslateDocumentRequest,
  type TranslateDocumentResponse,
} from './schema';

type Page = { page: number; text: string };
type Image = ExtractedPdf['images'][number];

export interface DocChunk {
  pages: Page[];
  images: Image[];
}

/** Podział długiej strony na części po pełnych liniach (twardo, gdy linia jest dłuższa niż limit). */
function splitPage(page: Page, max: number): Page[] {
  if (page.text.length <= max) return [page];
  const parts: Page[] = [];
  let buf = '';
  for (const line of page.text.split('\n')) {
    if (line.length > max) {
      if (buf) parts.push({ page: page.page, text: buf });
      buf = '';
      for (let i = 0; i < line.length; i += max)
        parts.push({ page: page.page, text: line.slice(i, i + max) });
      continue;
    }
    if (buf.length + line.length + 1 > max) {
      parts.push({ page: page.page, text: buf });
      buf = '';
    }
    buf += (buf ? '\n' : '') + line;
  }
  if (buf) parts.push({ page: page.page, text: buf });
  return parts;
}

/**
 * Fragmenty do tłumaczenia: całe strony do limitu znaków i obrazów, długa strona w kilku
 * fragmentach. Puste strony bez obrazu nie są wysyłane.
 */
export function planChunks(
  doc: Pick<ExtractedPdf, 'pages' | 'images'>,
  maxChars = MAX_TRANSLATE_CHUNK_CHARS,
  maxImages = MAX_TRANSLATE_CHUNK_IMAGES,
): DocChunk[] {
  const imageFor = new Map(doc.images.map((i) => [i.page, i]));
  const chunks: DocChunk[] = [];
  let current: DocChunk = { pages: [], images: [] };
  const chars = (c: DocChunk) => c.pages.reduce((n, p) => n + p.text.length, 0);
  const flush = () => {
    if (current.pages.length > 0) chunks.push(current);
    current = { pages: [], images: [] };
  };

  for (const page of doc.pages) {
    const image = imageFor.get(page.page);
    if (page.text.trim().length === 0 && !image) continue;
    const parts = splitPage(page, maxChars);
    if (parts.length > 1) {
      flush();
      parts.forEach((part, i) => {
        chunks.push({ pages: [part], images: i === 0 && image ? [image] : [] });
      });
      continue;
    }
    const tooLong = chars(current) + page.text.length > maxChars;
    const tooManyImages = image !== undefined && current.images.length >= maxImages;
    if (tooLong || tooManyImages) flush();
    current.pages.push(page);
    if (image) current.images.push(image);
  }
  flush();
  return chunks;
}

export interface DocumentTranslationResult {
  pages: Page[];
  issues: NumericIssue[];
  scannedPages: number[];
  model: string;
}

export type ProgressEvent = { done: number; total: number; waitingSeconds?: number };

export class DocumentTooLongError extends Error {
  constructor(public readonly chars: number) {
    super('DOC_TOO_LONG');
    this.name = 'DocumentTooLongError';
  }
}

interface RetryableError {
  code?: string;
  status?: number;
  retryAfterSeconds?: number;
}

const isRateLimit = (e: unknown): e is RetryableError => {
  const err = e as RetryableError | null;
  return (
    !!err && (err.code === 'RATE_LIMITED' || err.code === 'AI_RATE_LIMITED' || err.status === 429)
  );
};

const abortableSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Anulowano', 'AbortError'));
      },
      { once: true },
    );
  });

/**
 * Tłumaczy cały dokument fragment po fragmencie. Przy limicie zapytań (HTTP 429) czeka tyle,
 * ile wskazał serwer (maks. 3 razy na fragment), zamiast przerywać całe tłumaczenie.
 */
export async function translateWholeDocument(
  doc: Pick<ExtractedPdf, 'pages' | 'images'>,
  sourceLanguage: string,
  target: OutputLanguage,
  options: {
    signal: AbortSignal;
    onProgress?: (p: ProgressEvent) => void;
    translateChunk: (
      req: TranslateDocumentRequest,
      signal: AbortSignal,
    ) => Promise<TranslateDocumentResponse>;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  },
): Promise<DocumentTranslationResult> {
  const total = doc.pages.reduce((n, p) => n + p.text.length, 0);
  if (total > MAX_TRANSLATE_DOCUMENT_CHARS) throw new DocumentTooLongError(total);
  const sleep = options.sleep ?? abortableSleep;
  const chunks = planChunks(doc);
  const translated = new Map<number, string[]>();
  const issues: NumericIssue[] = [];
  let model = '';

  options.onProgress?.({ done: 0, total: chunks.length });
  for (const [index, chunk] of chunks.entries()) {
    let attempt = 0;
    for (;;) {
      try {
        const res = await options.translateChunk(
          { target, sourceLanguage, pages: chunk.pages, images: chunk.images },
          options.signal,
        );
        model = res.model;
        for (const p of res.pages)
          translated.set(p.page, [...(translated.get(p.page) ?? []), p.text]);
        issues.push(...res.issues);
        break;
      } catch (e) {
        if (!isRateLimit(e) || attempt >= 3) throw e;
        attempt++;
        const seconds = Math.min(60, Math.max(5, e.retryAfterSeconds ?? 20));
        options.onProgress?.({ done: index, total: chunks.length, waitingSeconds: seconds });
        await sleep(seconds * 1000, options.signal);
      }
    }
    options.onProgress?.({ done: index + 1, total: chunks.length });
  }

  const scanned = new Set(doc.images.map((i) => i.page));
  return {
    pages: doc.pages
      .filter((p) => translated.has(p.page))
      .map((p) => ({ page: p.page, text: (translated.get(p.page) ?? []).join('\n') })),
    issues,
    scannedPages: doc.pages.map((p) => p.page).filter((n) => scanned.has(n) && translated.has(n)),
    model,
  };
}
