/** Minimalny kształt elementu tekstu z pdf.js (TextItem). */
export interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  hasEOL: boolean;
}

const LIGATURES: Record<string, string> = {
  '\uFB00': 'ff',
  '\uFB01': 'fi',
  '\uFB02': 'fl',
  '\uFB03': 'ffi',
  '\uFB04': 'ffl',
  '\uFB05': 'st',
  '\uFB06': 'st',
};

/**
 * Czyści tekst z PDF przed wysłaniem do modelu i przed heurystykami:
 * - ligatury (ﬁ, ﬂ) → zwykłe litery, inaczej "conﬁdential" nie pasuje do żadnego wzorca,
 * - twarde spacje (także wąska U+202F, typowy separator tysięcy w polskich dokumentach) → spacja,
 * - usuwa miękkie łączniki, znaki zerowej szerokości i znaki sterujące kierunkiem tekstu
 *   (można nimi ukryć polecenie przed heurystyką albo przestawić jego wizualną kolejność),
 * - usuwa znaki kontrolne poza nową linią i tabulatorem.
 */
export function cleanText(text: string): string {
  return (
    text
      .replace(/[\uFB00-\uFB06]/g, (ch) => LIGATURES[ch] ?? ch)
      .replace(/[\u00A0\u2007\u202F]/g, ' ')
      .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  );
}

/**
 * Składa tekst strony z elementów pdf.js na podstawie ich położenia.
 * Wiele PDF-ów zapisuje polskie znaki (ś, ż, ł) jako osobne elementy bez odstępu;
 * proste łączenie spacją dałoby "wcze ś niejsze" zamiast "wcześniejsze".
 * Spację wstawiamy tylko wtedy, gdy między elementami jest faktyczna przerwa.
 */
export function joinTextItems(items: TextItemLike[]): string {
  let out = '';
  // Koniec poprzedniego elementu i kierunek linii bazowej (obsługa stron obróconych).
  let prev: { x: number; y: number; dx: number; dy: number } | null = null;

  for (const item of items) {
    const [a = 1, b = 0, c = 0, d = 1, x = 0, y = 0] = item.transform;
    const size = Math.hypot(c, d) || 10;
    const len = Math.hypot(a, b) || 1;
    const dx = a / len;
    const dy = b / len;

    if (prev && item.str.length > 0) {
      const vx = x - prev.x;
      const vy = y - prev.y;
      // Odległość wzdłuż linii (odstęp między słowami) i w poprzek (zmiana wiersza).
      const along = vx * prev.dx + vy * prev.dy;
      const across = Math.abs(-vx * prev.dy + vy * prev.dx);
      const sameDirection = Math.abs(dx - prev.dx) < 0.01 && Math.abs(dy - prev.dy) < 0.01;
      if (!sameDirection || across > size * 0.5) {
        if (!out.endsWith('\n')) out += '\n';
      } else if (along > size * 0.15 && !out.endsWith(' ') && !item.str.startsWith(' ')) {
        out += ' ';
      }
    }

    out += cleanText(item.str);
    if (item.str.length > 0 || item.width > 0) {
      prev = { x: x + item.width * dx, y: y + item.width * dy, dx, dy };
    }
    if (item.hasEOL) {
      out += '\n';
      prev = null;
    }
  }

  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
