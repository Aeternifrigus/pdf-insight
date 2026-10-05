/** Minimalny kształt elementu tekstu z pdf.js (TextItem). */
export interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  hasEOL: boolean;
}

/**
 * Składa tekst strony z elementów pdf.js na podstawie ich położenia.
 * Wiele PDF-ów zapisuje polskie znaki (ś, ż, ł) jako osobne elementy bez odstępu;
 * proste łączenie spacją dałoby "wcze ś niejsze" zamiast "wcześniejsze".
 * Spację wstawiamy tylko wtedy, gdy między elementami jest faktyczna przerwa.
 */
export function joinTextItems(items: TextItemLike[]): string {
  let out = '';
  let prevEndX: number | null = null;
  let prevY: number | null = null;

  for (const item of items) {
    const x = item.transform[4] ?? 0;
    const y = item.transform[5] ?? 0;
    const size = Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0) || 10;

    if (prevEndX !== null && prevY !== null && item.str.length > 0) {
      const sameLine = Math.abs(y - prevY) < size * 0.5;
      if (!sameLine) {
        if (!out.endsWith('\n')) out += '\n';
      } else {
        const gap = x - prevEndX;
        const needsSpace = gap > size * 0.15 && !out.endsWith(' ') && !item.str.startsWith(' ');
        if (needsSpace) out += ' ';
      }
    }

    out += item.str;
    if (item.str.length > 0 || item.width > 0) {
      prevEndX = x + item.width;
      prevY = y;
    }
    if (item.hasEOL) {
      out += '\n';
      prevEndX = null;
      prevY = null;
    }
  }

  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
