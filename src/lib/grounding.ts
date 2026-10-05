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

/** Możliwe wartości liczbowe zapisu: "184 500,00", "1,234.56", "8 600", "1.5". */
function interpretations(token: string): number[] {
  const t = token.replace(/[\s']/g, '');
  const out: number[] = [];
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  const asNumber = (s: string) => {
    const n = Number(s);
    if (Number.isFinite(n)) out.push(round2(n));
  };
  // Separator dziesiętny to ostatni z [.,], a wcześniejsze znaki to separatory tysięcy.
  if (lastComma > lastDot)
    asNumber(t.slice(0, lastComma).replace(/[.,]/g, '') + '.' + t.slice(lastComma + 1));
  if (lastDot > lastComma)
    asNumber(t.slice(0, lastDot).replace(/[.,]/g, '') + '.' + t.slice(lastDot + 1));
  // Ten sam znak jako separator tysięcy ("12,345", "1.234.567").
  asNumber(t.replace(/[.,]/g, ''));
  return out;
}

/** Wszystkie wartości liczbowe, które można odczytać z tekstu (także "4,2 mln" → 4 200 000). */
export function numbersInText(text: string): Set<number> {
  const values = new Set<number>();
  const clean = cleanText(text);
  const re = /\d(?:[\d.,']|\s(?=\d))*\d|\d/g;
  for (const m of clean.matchAll(re)) {
    const token = m[0];
    // Kolumny tabel bywają sklejone spacjami ("2 140 58%"), więc bierzemy też podciągi grup.
    const groups = token.split(/\s+/);
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j <= Math.min(groups.length, i + 6); j++) {
        for (const v of interpretations(groups.slice(i, j).join(' '))) values.add(v);
      }
    }
    const after = clean.slice(m.index + token.length, m.index + token.length + 12);
    const word = /^\s*([a-ząćęłńóśźż]+)\.?/i.exec(after)?.[1]?.toLowerCase();
    const mult = word ? MULTIPLIERS[word] : undefined;
    if (mult) for (const v of interpretations(token)) values.add(round2(v * mult));
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
