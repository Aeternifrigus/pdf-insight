import { splitInjectedLines } from './injection';
import { detectDecimalStyle, extractDates, parseNumbers, type DecimalStyle } from './localeNumbers';
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

// ---------------------------------------------------------------------------
// Dowody z dokumentu: wartości, waluty i daty, z wyłączeniem podejrzanych poleceń
// ---------------------------------------------------------------------------

const CURRENCY_WORDS: Record<string, string> = {
  zł: 'PLN',
  zl: 'PLN',
  złotych: 'PLN',
  złote: 'PLN',
  złoty: 'PLN',
  pln: 'PLN',
  eur: 'EUR',
  euro: 'EUR',
  '€': 'EUR',
  usd: 'USD',
  $: 'USD',
  us$: 'USD',
  dolarów: 'USD',
  gbp: 'GBP',
  '£': 'GBP',
  chf: 'CHF',
};
const CURRENCY_ALT = 'zł|zl|złotych|złote|złoty|PLN|EUR|euro|€|USD|US\\$|\\$|dolarów|GBP|£|CHF';
const AFTER_RE = new RegExp(
  `^\\s*(?:(tys\\.?|mln|mld|million|billion|thousand)\\s*)?(${CURRENCY_ALT})(?![\\p{L}])`,
  'iu',
);
const BEFORE_RE = new RegExp(`(?:^|[^\\p{L}])(${CURRENCY_ALT})\\s*$`, 'iu');
const MULT: Record<string, number> = {
  tys: 1e3,
  'tys.': 1e3,
  thousand: 1e3,
  mln: 1e6,
  million: 1e6,
  mld: 1e9,
  billion: 1e9,
};

export interface MoneyMention {
  value: number;
  currency: string;
}

/**
 * Kwoty z jawnie zapisaną walutą: "184 500,00 zł", "8 600 EUR", "PLN 184,500.00", "$890",
 * "4,2 mln zł". Liczby bez waluty (np. komórki tabel) nie są tu brane pod uwagę.
 */
export function moneyMentions(text: string, style: DecimalStyle): MoneyMention[] {
  const { rest } = extractDates(text);
  const out: MoneyMention[] = [];
  for (const token of parseNumbers(rest, style === 'unknown' ? 'comma' : style)) {
    const end = token.index + token.raw.length;
    const after = AFTER_RE.exec(rest.slice(end, end + 24));
    const before = BEFORE_RE.exec(rest.slice(Math.max(0, token.index - 6), token.index));
    const word = after?.[2] ?? before?.[1];
    const currency = word ? CURRENCY_WORDS[word.toLowerCase()] : undefined;
    if (!currency) continue;
    const mult = after?.[1] ? (MULT[after[1].toLowerCase()] ?? 1) : 1;
    out.push({ value: round2(token.value * mult), currency });
  }
  return out;
}

export interface Evidence {
  style: DecimalStyle;
  /** Wszystkie liczby z tekstu poza podejrzanymi poleceniami. */
  numbers: Set<number>;
  /** Wartość → waluty, z którymi występuje w tekście (poza podejrzanymi poleceniami). */
  money: Map<number, Set<string>>;
  folded: string;
  /** Kwoty i daty, które w dokumencie występują wyłącznie w podejrzanym poleceniu. */
  injectedMoney: MoneyMention[];
  injectedNumbers: Set<number>;
  injectedDates: Set<string>;
}

export function buildEvidence(pages: { text: string }[], languageHint?: string | null): Evidence {
  const parts = pages.map((p) => splitInjectedLines(p.text));
  const clean = parts.map((p) => p.clean).join('\n');
  const injected = parts.map((p) => p.injected).join('\n');
  const style = detectDecimalStyle(clean, languageHint);
  // Liczba przełamana między wierszami ("(295" / "200,00 zł") jest w PDF częsta. Wersja z
  // połączonymi grupami cyfr jest dodawana obok oryginału (suma zbiorów), żeby prawdziwa
  // wartość nie była zgłaszana jako nieznaleziona.
  const joined = clean.replace(/(\d)[ \t]*\n[ \t]*(\d{3}(?:[,.]\d+)?)(?!\d)/g, '$1 $2');
  const numbers = new Set([...numbersInText(clean, style), ...numbersInText(joined, style)]);
  const money = new Map<number, Set<string>>();
  for (const m of [...moneyMentions(clean, style), ...moneyMentions(joined, style)]) {
    money.set(m.value, (money.get(m.value) ?? new Set()).add(m.currency));
  }
  const folded = foldForSearch(clean);
  const injectedMoney = moneyMentions(injected, style).filter(
    (m) => !money.get(m.value)?.has(m.currency),
  );
  const injectedNumbers = new Set(
    [...numbersInText(injected, style)].filter((n) => !numbers.has(n)),
  );
  const injectedDates = new Set(extractDates(injected).dates.filter((d) => !dateInText(d, folded)));
  return { style, numbers, money, folded, injectedMoney, injectedNumbers, injectedDates };
}

export type AmountCheck = 'ok' | 'notInText' | 'currencyMismatch' | 'fromInstruction';

/**
 * Sprawdzenie kwoty z wyniku:
 * - fromInstruction: wartość (z tą walutą) występuje w dokumencie tylko w podejrzanym poleceniu,
 * - currencyMismatch: wartość występuje w dokumencie wyłącznie z inną walutą (np. 8 600 EUR jako PLN),
 * - notInText: wartości nie ma w tekście,
 * - ok: wartość jest w tekście.
 */
export function checkAmount(value: number, currency: string, ev: Evidence): AmountCheck {
  const v = round2(Math.abs(value));
  const fromInjection =
    ev.injectedMoney.some((m) => m.value === v && m.currency === currency) ||
    (!ev.numbers.has(v) && ev.injectedNumbers.has(v));
  if (fromInjection) return 'fromInstruction';
  const currencies = ev.money.get(v);
  if (currencies && currencies.size > 0 && !currencies.has(currency)) return 'currencyMismatch';
  return ev.numbers.has(v) ? 'ok' : 'notInText';
}

export type DateCheck = 'ok' | 'notInText' | 'fromInstruction';

export function checkDate(iso: string, ev: Evidence): DateCheck {
  if (dateInText(iso, ev.folded)) return 'ok';
  return ev.injectedDates.has(iso) ? 'fromInstruction' : 'notInText';
}
