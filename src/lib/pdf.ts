// Wersja „legacy” zawiera polyfille: pdf.js 6 używa m.in. Math.sumPrecise, którego starsze
// przeglądarki (Chrome przed 147, starsze Safari) nie mają. Bez tego każda strona kończyła się
// wyjątkiem, a użytkownik widział mylący komunikat „W pliku nie ma tekstu”.
import {
  getDocument,
  GlobalWorkerOptions,
  OPS,
  PasswordException,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
// Import z ?url sprawia, że Vite kopiuje workera do dist/ i zwraca ścieżkę z uwzględnieniem `base`
// (na GitHub Pages: /<repo>/assets/pdf.worker-*.mjs). Bez tego worker pdf.js zwraca 404.
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { PdfReadError } from './file';
import { formFieldLines } from './forms';
import {
  isBlankImage,
  MIN_TEXT_CHARS,
  renderScale,
  SCAN_WITH_HEADER_CHARS,
  selectScanPages,
  type PageInfo,
} from './scan';
import { MAX_IMAGE_BASE64_CHARS, MAX_IMAGES, MAX_TEXT_CHARS } from './schema';
import { joinTextItems } from './textItems';

GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Zasoby pdf.js kopiowane do public/pdfjs (scripts/copy-pdfjs-assets.mjs):
 * - wasm: dekodery JPEG 2000 i JBIG2, typowych w skanach (bez nich skan renderuje się na biało),
 * - cmaps: kodowania fontów CID (bez nich tekst części PDF-ów jest nieczytelny),
 * - standard_fonts: fonty standardowe niewbudowane w plik,
 * - iccs: profile kolorów CMYK.
 */
const ASSETS = `${import.meta.env.BASE_URL}pdfjs/`;

const IMAGE_OPS = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
  OPS.paintInlineImageXObjectGroup,
]);

/** Uwaga o stronach jako dane; tekst powstaje w interfejsie w wybranym języku. */
export type PdfNote =
  | { kind: 'skipped'; pages: number[]; limit: number }
  | { kind: 'failed'; pages: number[] }
  | { kind: 'blank'; pages: number[] };

export interface ExtractedPdf {
  pageCount: number;
  pages: { page: number; text: string }[];
  images: { page: number; mimeType: 'image/jpeg'; data: string }[];
  /** Uwagi dla użytkownika o stronach, których nie udało się w pełni odczytać. */
  notes: PdfNote[];
  /** Strony z treścią, która nie trafi do analizy (skany ponad limit, błędy odczytu). */
  unreadPages: number[];
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Anulowano', 'AbortError');
}

export async function extractPdf(
  file: File,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ExtractedPdf> {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = getDocument({
    data,
    wasmUrl: `${ASSETS}wasm/`,
    cMapUrl: `${ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    iccUrl: `${ASSETS}iccs/`,
  });
  const onAbort = () => void task.destroy();
  signal?.addEventListener('abort', onAbort, { once: true });

  let pdf: PDFDocumentProxy;
  try {
    pdf = await task.promise;
  } catch (e) {
    signal?.removeEventListener('abort', onAbort);
    void task.destroy();
    throwIfAborted(signal);
    if (e instanceof PasswordException) {
      throw new PdfReadError('PASSWORD');
    }
    throw new PdfReadError('CORRUPT');
  }

  try {
    if (pdf.numPages > 2000) {
      throw new PdfReadError('TOO_MANY_PAGES', { pages: pdf.numPages });
    }

    const pages: ExtractedPdf['pages'] = [];
    const info: PageInfo[] = [];
    const failed: number[] = [];

    // Etap 1: tekst wszystkich stron. Błąd jednej strony nie przerywa całego odczytu.
    let totalChars = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      throwIfAborted(signal);
      try {
        const page = await pdf.getPage(n);
        const text = await pageText(page);
        const textChars = text.replace(/\s/g, '').length;
        // Lista operacji (wykrycie obrazów) jest kosztowna, bo dekoduje obrazy strony.
        // Potrzebna tylko dla stron "pomiędzy": strona bez tekstu i tak jest kandydatem na skan.
        const hasImages =
          textChars >= MIN_TEXT_CHARS && textChars < SCAN_WITH_HEADER_CHARS
            ? await pageHasImages(page)
            : false;
        pages.push({ page: n, text });
        info.push({ page: n, textChars, hasImages });
        totalChars += text.length;
        page.cleanup();
      } catch {
        throwIfAborted(signal);
        failed.push(n);
        pages.push({ page: n, text: '' });
        info.push({ page: n, textChars: 0, hasImages: true });
      }
      onProgress?.(n, pdf.numPages);
      // Wszystkie strony z wyjątkiem to problem przeglądarki lub pliku, a nie brak tekstu.
      if (n === pdf.numPages && failed.length === pdf.numPages) {
        throw new PdfReadError('UNREADABLE');
      }
      // Przerywamy od razu, zamiast czytać setki kolejnych stron tylko po to, żeby odrzucić plik.
      if (totalChars > MAX_TEXT_CHARS) {
        throw new PdfReadError('TOO_MUCH_TEXT', { page: n, total: pdf.numPages });
      }
    }

    // Etap 2: strony bez użytecznej warstwy tekstowej renderujemy do JPEG.
    const { selected, skipped } = selectScanPages(info, MAX_IMAGES);
    const images: ExtractedPdf['images'] = [];
    const blank: number[] = [];
    for (const n of selected) {
      throwIfAborted(signal);
      try {
        const page = await pdf.getPage(n);
        const result = await renderPage(page);
        page.cleanup();
        if (result?.kind === 'blank') blank.push(n);
        else if (result?.kind === 'image') {
          images.push({ page: n, mimeType: 'image/jpeg', data: result.data });
        } else failed.push(n);
      } catch {
        throwIfAborted(signal);
        failed.push(n);
      }
    }

    const notes: PdfNote[] = [];
    if (skipped.length > 0) notes.push({ kind: 'skipped', pages: skipped, limit: MAX_IMAGES });
    if (failed.length > 0) notes.push({ kind: 'failed', pages: [...new Set(failed)] });
    if (blank.length > 0) notes.push({ kind: 'blank', pages: blank });

    const unreadPages = [...new Set([...skipped, ...failed])].sort((a, b) => a - b);
    return { pageCount: pdf.numPages, pages, images, notes, unreadPages };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    void task.destroy();
  }
}

async function pageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent();
  const text = joinTextItems(content.items.filter((item) => 'str' in item));
  const annotations: unknown = await page.getAnnotations({ intent: 'display' });
  const fields = formFieldLines(Array.isArray(annotations) ? (annotations as unknown[]) : []);
  return fields.length > 0 ? `${text}\n[Pola formularza]\n${fields.join('\n')}` : text;
}

async function pageHasImages(page: PDFPageProxy): Promise<boolean> {
  const ops = await page.getOperatorList();
  return ops.fnArray.some((fn) => IMAGE_OPS.has(fn));
}

/**
 * Renderuje stronę do JPEG (base64) na potrzeby odczytu skanu przez model multimodalny.
 * Zwraca null, gdy nie da się utworzyć kontekstu canvas.
 */
type RenderResult = { kind: 'image'; data: string } | { kind: 'blank' } | { kind: 'too-large' };

async function renderPage(page: PDFPageProxy): Promise<RenderResult | null> {
  const base = page.getViewport({ scale: 1 });
  // Limit pikseli chroni przed przekroczeniem maksymalnego rozmiaru canvas (np. iOS Safari).
  const viewport = page.getViewport({ scale: renderScale(base.width, base.height) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;

  if (isBlankCanvas(canvas)) return { kind: 'blank' };

  try {
    for (const quality of [0.75, 0.6, 0.45, 0.3]) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      if (b64.length <= MAX_IMAGE_BASE64_CHARS) return { kind: 'image', data: b64 };
    }
    return { kind: 'too-large' };
  } finally {
    // Zwolnienie pamięci canvas (ważne na telefonach).
    canvas.width = 0;
    canvas.height = 0;
  }
}

function isBlankCanvas(source: HTMLCanvasElement): boolean {
  const thumb = document.createElement('canvas');
  thumb.width = 256;
  thumb.height = 256;
  const ctx = thumb.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(source, 0, 0, 256, 256);
  return isBlankImage(ctx.getImageData(0, 0, 256, 256).data);
}
