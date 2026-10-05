/**
 * Decyzje o odczycie stron jako skanów. Czyste funkcje, bez pdf.js, żeby dało się je testować.
 */

export interface PageInfo {
  page: number;
  /** Liczba znaków tekstu (bez odstępów) w warstwie tekstowej. */
  textChars: number;
  /** Czy strona rysuje co najmniej jeden obraz. */
  hasImages: boolean;
}

/** Poniżej tej liczby znaków strona na pewno nie ma użytecznej warstwy tekstowej. */
export const MIN_TEXT_CHARS = 30;
/**
 * Strona z obrazem i krótkim tekstem to najczęściej skan z dodanym nagłówkiem,
 * stopką lub pieczątką archiwum ("Kopia elektroniczna... strona 1/1").
 * Sam próg MIN_TEXT_CHARS takiej strony nie wyłapie i jej treść by zginęła.
 */
export const SCAN_WITH_HEADER_CHARS = 400;

export function isScanCandidate(info: PageInfo): boolean {
  if (info.textChars < MIN_TEXT_CHARS) return true;
  return info.hasImages && info.textChars < SCAN_WITH_HEADER_CHARS;
}

/**
 * Wybiera strony do odczytu ze skanu. Przy limicie pierwszeństwo mają strony
 * z najmniejszą ilością tekstu (najpewniej prawdziwe skany), a nie pierwsze w kolejności.
 */
export function selectScanPages(
  pages: PageInfo[],
  max: number,
): { selected: number[]; skipped: number[] } {
  const candidates = pages.filter(isScanCandidate);
  const ranked = [...candidates].sort((a, b) => a.textChars - b.textChars || a.page - b.page);
  const selected = ranked
    .slice(0, max)
    .map((p) => p.page)
    .sort((a, b) => a - b);
  const skipped = candidates.map((p) => p.page).filter((p) => !selected.includes(p));
  return { selected, skipped };
}

/** Skala renderowania: szerokość do `maxWidth`, maks. 2×, łącznie nie więcej niż `maxPixels`. */
export function renderScale(
  width: number,
  height: number,
  maxWidth = 1400,
  maxPixels = 4_000_000,
): number {
  return Math.min(2, maxWidth / width, Math.sqrt(maxPixels / (width * height)));
}

/**
 * Czy wyrenderowana strona jest pusta. Taka strona nie trafia do modelu: pusty obraz
 * zachęca model do zmyślania, a często oznacza też, że obrazu nie dało się zdekodować.
 * Liczymy piksele "tuszu" (wyraźnie różne od tła), a nie odchylenie standardowe:
 * strona z jedną krótką linijką tekstu ma bardzo małe odchylenie, ale nie jest pusta.
 * `rgba` to piksele zmniejszonej kopii strony (np. 256×256).
 */
export function isBlankImage(rgba: Uint8ClampedArray, minInkPixels = 8): boolean {
  const n = rgba.length / 4;
  if (n === 0) return true;
  const luma = new Float32Array(n);
  let sum = 0;
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    const y = 0.299 * (rgba[i] ?? 0) + 0.587 * (rgba[i + 1] ?? 0) + 0.114 * (rgba[i + 2] ?? 0);
    luma[j] = y;
    sum += y;
  }
  const background = sum / n;
  let ink = 0;
  for (const y of luma) if (Math.abs(y - background) > 24) ink++;
  return ink < minInkPixels;
}
