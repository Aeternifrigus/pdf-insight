import { getDocument, GlobalWorkerOptions, OPS, PasswordException } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
// Import z ?url sprawia, że Vite kopiuje workera do dist/ i zwraca ścieżkę z uwzględnieniem `base`
// (na GitHub Pages: /<repo>/assets/pdf.worker-*.mjs). Bez tego worker pdf.js zwraca 404.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PdfReadError } from './file';
import { formFieldLines } from './forms';
import { formatPageRanges } from './ranges';
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

export interface ExtractedPdf {
  pageCount: number;
  pages: { page: number; text: string }[];
  images: { page: number; mimeType: 'image/jpeg'; data: string }[];
  /** Uwagi dla użytkownika o stronach, których nie udało się w pełni odczytać. */
  notes: string[];
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
      throw new PdfReadError('Plik jest zabezpieczony hasłem. Usuń hasło i spróbuj ponownie.');
    }
    throw new PdfReadError('Nie udało się otworzyć pliku. Może być uszkodzony.');
  }

  try {
    if (pdf.numPages > 2000) {
      throw new PdfReadError(`Plik ma ${pdf.numPages} stron. Limit to 2000 stron.`);
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
      // Przerywamy od razu, zamiast czytać setki kolejnych stron tylko po to, żeby odrzucić plik.
      if (totalChars > MAX_TEXT_CHARS) {
        throw new PdfReadError(
          `Dokument ma ponad ${MAX_TEXT_CHARS.toLocaleString('pl-PL')} znaków tekstu (przekroczone na stronie ${String(n)} z ${String(pdf.numPages)}). Spróbuj krótszego pliku.`,
        );
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

    const notes: string[] = [];
    if (skipped.length > 0) {
      notes.push(
        `${pagesWord(skipped)} ${formatPageRanges(skipped)} wyglądają na skany i nie zostały odczytane (limit to ${String(MAX_IMAGES)} zeskanowane strony).`,
      );
    }
    if (failed.length > 0) {
      notes.push(
        `Nie udało się odczytać: ${pagesWord(failed).toLowerCase()} ${formatPageRanges(failed)}.`,
      );
    }
    if (blank.length > 0) {
      notes.push(`${pagesWord(blank)} ${formatPageRanges(blank)} są puste i zostały pominięte.`);
    }

    return { pageCount: pdf.numPages, pages, images, notes };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    void task.destroy();
  }
}

function pagesWord(list: number[]): string {
  return list.length === 1 ? 'Strona' : 'Strony';
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
