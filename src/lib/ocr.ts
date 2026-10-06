import type { OcrPage } from './ocrCoverage';
import type { AnalyzeRequest } from './schema';

/**
 * Niezależny odczyt zeskanowanych stron (Tesseract, w przeglądarce, bez AI).
 *
 * Model AI czyta skany sam i jego odczytu nie było czym sprawdzić: kwoty i daty ze skanu
 * dostawały „nie da się sprawdzić” (foundInText = null). Tekst z OCR jest drugim, niezależnym
 * źródłem: kontrola wartości (verify.ts) traktuje go jak tekst dokumentu, więc wartość, którą
 * model „odczytał” ze skanu, a której na skanie nie ma, zostaje oznaczona.
 *
 * Działa równolegle z zapytaniem do AI, więc nie wydłuża analizy. Każdy błąd (brak pamięci,
 * przekroczony czas, nieobsługiwana przeglądarka) kończy się pustym wynikiem, a wartości ze
 * skanów pozostają wtedy oznaczone jako niesprawdzone, jak wcześniej.
 */

/** Limit czasu całego OCR; po nim wynik analizy jest pokazywany bez tej kontroli. */
export const OCR_TIMEOUT_MS = 25_000;

export async function ocrScans(
  images: AnalyzeRequest['images'],
  signal?: AbortSignal,
): Promise<OcrPage[]> {
  if (images.length === 0) return [];
  try {
    return await withTimeout(recognizeAll(images, signal), OCR_TIMEOUT_MS);
  } catch {
    return [];
  }
}

async function recognizeAll(
  images: AnalyzeRequest['images'],
  signal?: AbortSignal,
): Promise<OcrPage[]> {
  const { createWorker, OEM } = await import('tesseract.js');
  const base = `${import.meta.env.BASE_URL}ocr/`;
  const worker = await createWorker('pol', OEM.LSTM_ONLY, {
    workerPath: `${base}worker.min.js`,
    corePath: base,
    langPath: base,
    gzip: true,
    // Worker z własnej domeny, nie z adresu blob: (prostsza i węższa polityka CSP).
    workerBlobURL: false,
  });
  const onAbort = () => void worker.terminate();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const out: OcrPage[] = [];
    for (const img of images) {
      if (signal?.aborted) break;
      const { data } = await worker.recognize(`data:${img.mimeType};base64,${img.data}`);
      out.push({ page: img.page, text: data.text });
    }
    return out;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await worker.terminate().catch(() => undefined);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('OCR timeout'));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
