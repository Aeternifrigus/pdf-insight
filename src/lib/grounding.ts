import { extractDates, parseNumbers, type DecimalStyle } from './localeNumbers';
import { cleanText } from './textItems';

/**
 * Sprawdzenie, czy kwoty i daty zwrócone przez model rzeczywiście występują w tekście dokumentu.
 * Brief wymaga wyników "bez zmyślonych informacji"; walidacja schematu sprawdza tylko format,
 * a nie to, czy wartość pochodzi z dokumentu. Funkcje są deterministyczne i nie używają AI.
 */

const MULTIPLIERS: Record<string, number> = {
  tys: 1e3,
  tysiąc: 1e3,
  tysięcy: 1e3,
  thousand: 1e3,
  k: 1e3,
  mln: 1e6,
  milion: 1e6,
  miliona: 1e6,
  milionów: 1e6,
  million: 1e6,
  mld: 1e9,
  miliard: 1e9,
  miliardów: 1e9,
  billion: 1e9,
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Wartości liczbowe zapisane w tekście (także "4,2 mln" → 4 200 000), odczytane według stylu
 * zapisu dokumentu. Przy stylu 'unknown' przyjmowane są obie interpretacje (łagodniej).
 * Wcześniejsza wersja zawsze brała obie, przez co "12,345 zł" w polskim tekście "potwierdzało"
 * kwotę 12 345 zwróconą przez model, czyli błąd o czynnik 1000.
 */
export function numbersInText(text: string, style: DecimalStyle = 'unknown'): Set<number> {
  const values = new Set<number>();
  const { rest } = extractDates(text);
  for (const token of parseNumbers(rest, style)) {
    values.add(token.value);
    const after = rest.slice(token.index + token.raw.length, token.index + token.raw.length + 12);
    const word = /^\s*([a-ząćęłńóśźż]+)\.?/i.exec(after)?.[1]?.toLowerCase();
    const mult = word ? MULTIPLIERS[word] : undefined;
    if (mult) values.add(round2(token.value * mult));
  }
  return values;
}

export function amountInText(value: number, numbers: Set<number>): boolean {
  return numbers.has(round2(Math.abs(value)));
}

/** Wystąpienie bez przylegających cyfr: "2.3.2026" nie może pasować wewnątrz "12.3.2026". */
function containsStandalone(haystack: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) return false;
    const before = haystack[i - 1] ?? '';
    const after = haystack[i + needle.length] ?? '';
    if (!/\d/.test(before) && !/\d/.test(after)) return true;
    from = i + 1;
  }
}

const PL_MONTHS = [
  'stycznia',
  'lutego',
  'marca',
  'kwietnia',
  'maja',
  'czerwca',
  'lipca',
  'sierpnia',
  'wrzesnia',
  'pazdziernika',
  'listopada',
  'grudnia',
];
const EN_MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const DE_MONTHS = [
  'januar',
  'februar',
  'marz',
  'april',
  'mai',
  'juni',
  'juli',
  'august',
  'september',
  'oktober',
  'november',
  'dezember',
];

/** Tekst bez znaków diakrytycznych, małymi literami, z pojedynczymi spacjami. */
export function foldForSearch(text: string): string {
  return cleanText(text)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Czy data ISO (YYYY-MM-DD) występuje w tekście w którymś z typowych zapisów. */
export function dateInText(iso: string, folded: string): boolean {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return false;
  const mi = Number(m) - 1;
  const dd = String(Number(d));
  const mm = String(Number(m));
  const numeric = [
    `${d}.${m}.${y}`,
    `${dd}.${mm}.${y}`,
    `${d}/${m}/${y}`,
    `${dd}/${mm}/${y}`,
    `${m}/${d}/${y}`,
    `${mm}/${dd}/${y}`,
    `${d}-${m}-${y}`,
    `${y}-${m}-${d}`,
    `${y}.${m}.${d}`,
  ];
  const months = [PL_MONTHS[mi], EN_MONTHS[mi], DE_MONTHS[mi]].filter(Boolean) as string[];
  const verbal = months.flatMap((name) => [
    `${dd} ${name} ${y}`,
    `${d} ${name} ${y}`,
    `${dd}. ${name} ${y}`,
    `${name} ${dd}, ${y}`,
    `${name} ${dd} ${y}`,
  ]);
  return [...numeric, ...verbal].some((v) => containsStandalone(folded, v));
}
