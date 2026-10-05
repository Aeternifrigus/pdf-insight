import { getDocument, GlobalWorkerOptions, PasswordException } from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
// Import z ?url sprawia, że Vite kopiuje workera do dist/ i zwraca ścieżkę z uwzględnieniem `base`
// (na GitHub Pages: /<repo>/assets/pdf.worker-*.mjs). Bez tego worker pdf.js zwraca 404.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PdfReadError } from './file';
import { MAX_IMAGE_BASE64_CHARS, MAX_IMAGES } from './schema';
import { joinTextItems } from './textItems';

GlobalWorkerOptions.workerSrc = workerUrl;

/** Strona z mniejszą liczbą znaków traktowana jest jako skan bez warstwy tekstowej. */
export const SCAN_TEXT_THRESHOLD = 30;
const RENDER_MAX_WIDTH = 1400;

export interface ExtractedPdf {
  pageCount: number;
  pages: { page: number; text: string }[];
  images: { page: number; mimeType: 'image/jpeg'; data: string }[];
  /** Strony bez tekstu, których nie wysłano jako obraz (powyżej limitu). */
  skippedScanPages: number[];
}

export async function extractPdf(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractedPdf> {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = getDocument({ data });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (e) {
    void task.destroy();
    if (e instanceof PasswordException) {
      throw new PdfReadError('Plik jest zabezpieczony hasłem. Usuń hasło i spróbuj ponownie.');
    }
    throw new PdfReadError('Nie udało się otworzyć pliku. Może być uszkodzony.');
  }

  try {
    const pages: ExtractedPdf['pages'] = [];
    const images: ExtractedPdf['images'] = [];
    const skippedScanPages: number[] = [];

    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const text = await pageText(page);
      pages.push({ page: n, text });

      if (text.replace(/\s/g, '').length < SCAN_TEXT_THRESHOLD) {
        if (images.length < MAX_IMAGES) {
          const image = await renderPage(page);
          if (image) images.push({ page: n, mimeType: 'image/jpeg', data: image });
          else skippedScanPages.push(n);
        } else {
          skippedScanPages.push(n);
        }
      }
      page.cleanup();
      onProgress?.(n, pdf.numPages);
    }

    return { pageCount: pdf.numPages, pages, images, skippedScanPages };
  } finally {
    void task.destroy();
  }
}

async function pageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent();
  return joinTextItems(content.items.filter((item) => 'str' in item));
}

/** Renderuje stronę do JPEG (base64) na potrzeby odczytu skanu przez model multimodalny. */
async function renderPage(page: PDFPageProxy): Promise<string | null> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2, RENDER_MAX_WIDTH / base.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;

  for (const quality of [0.75, 0.6, 0.45]) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    if (b64.length <= MAX_IMAGE_BASE64_CHARS) return b64;
  }
  return null;
}
