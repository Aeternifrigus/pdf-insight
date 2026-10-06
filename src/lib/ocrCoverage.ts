import type { AnalyzeRequest } from './schema';

/** Tekst zeskanowanej strony odczytany przez OCR w przeglądarce (src/lib/ocr.ts). */
export interface OcrPage {
  page: number;
  text: string;
}

/** Strona z OCR, który niczego sensownego nie odczytał, nie jest dowodem na brak wartości. */
const MIN_OCR_CHARS = 20;

/** Czy OCR odczytał każdy skan; tylko wtedy brak wartości na skanie jest wiarygodny. */
export function ocrCovers(images: AnalyzeRequest['images'], ocr: OcrPage[]): boolean {
  return images.every((img) =>
    ocr.some((o) => o.page === img.page && o.text.replace(/\s/g, '').length >= MIN_OCR_CHARS),
  );
}
