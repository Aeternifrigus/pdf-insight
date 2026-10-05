/**
 * Przybliżone liczenie zdań (PL/EN/DE) na potrzeby walidacji podsumowania.
 * Kropka kończy zdanie, gdy po niej jest odstęp i wielka litera (nie cyfra:
 * w polskich tekstach "2027 r. 13 100 zł" to wciąż jedno zdanie),
 * a słowo przed kropką nie jest typowym skrótem ani inicjałem.
 */
const ABBREVIATIONS = new Set(
  [
    // polskie
    'ul',
    'nr',
    'np',
    'tj',
    'tzw',
    'm.in',
    'ok',
    'ust',
    'art',
    'pkt',
    'godz',
    'prof',
    'dr',
    'mgr',
    'inż',
    'św',
    'al',
    'pl',
    'os',
    'tel',
    'zob',
    'por',
    'wg',
    'poz',
    'tys',
    'mln',
    'mld',
    'dot',
    'ds',
    'sp',
    'zał',
    'lp',
    'im',
    // angielskie / niemieckie
    'mr',
    'mrs',
    'ms',
    'e.g',
    'i.e',
    'vs',
    'etc',
    'inc',
    'ltd',
    'no',
    'st',
    'z.b',
    'bzw',
    'ca',
    'str',
    'u.a',
  ].map((a) => a.toLowerCase()),
);

const BOUNDARY = /[.!?…]+["'”»)]*\s+(?=["'„«(]?\p{Lu})/gu;

export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  let count = 0;
  let lastIndex = 0;
  for (const match of trimmed.matchAll(BOUNDARY)) {
    const end = match.index;
    const before = trimmed.slice(lastIndex, end);
    const lastWord = (before.split(/\s+/).pop() ?? '').replace(/^[("„«']+/, '');
    const punct = match[0].trim()[0];
    if (punct === '.' && isNonTerminalAbbreviation(lastWord)) continue;
    count += 1;
    lastIndex = end + match[0].length;
  }
  if (trimmed.slice(lastIndex).trim().length > 0) count += 1;
  return count;
}

function isNonTerminalAbbreviation(word: string): boolean {
  if (!word) return false;
  // Inicjał, np. "A. Kowalczyk"
  if (/^\p{Lu}$/u.test(word)) return true;
  return ABBREVIATIONS.has(word.toLowerCase());
}
