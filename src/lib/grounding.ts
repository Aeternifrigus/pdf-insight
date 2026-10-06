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
// Waluta przed liczbą tylko w tym samym wierszu: w tabelach wiersz kończy się często na „zł”,
// a następny zaczyna się numerem pozycji („240,00 zł” / „2 Starszy programista”), co dawało „2 zł”.
const BEFORE_RE = new RegExp(`(?:^|[^\\p{L}])(${CURRENCY_ALT})[ \\t]*$`, 'iu');
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

/** Cechy kwoty zapisane w dokumencie tuż przy liczbie albo w opisie modelu. */
export type TaxLabel = 'net' | 'gross';
export type PeriodLabel = 'monthly' | 'yearly';
export interface AmountLabels {
  tax: Set<TaxLabel>;
  period: Set<PeriodLabel>;
}

const TAX_PATTERNS: [TaxLabel, RegExp][] = [
  ['net', /\bnetto\b|\bnet\b|bez\s+(?:podatku\s+)?vat|excl(?:uding|\.)?\s+vat/iu],
  ['gross', /\bbrutto\b|\bgross\b|z\s+(?:podatkiem\s+)?vat\b|incl(?:uding|\.)?\s+vat/iu],
];
const PERIOD_PATTERNS: [PeriodLabel, RegExp][] = [
  [
    'monthly',
    /miesięczn\p{L}*|\/\s?mies(?:\.|\b)|\bna\s+miesiąc\b|\bza\s+miesiąc\b|\bmonthly\b|\bper\s+month\b|\/\s?month\b/iu,
  ],
  [
    'yearly',
    /\brocz\p{L}*|\/\s?rok\b|\bza\s+rok\b|\bw\s+roku\b|\bannual\p{L}*|\byearly\b|\bper\s+year\b|\/\s?year\b|\bper\s+annum\b/iu,
  ],
];

function labelsIn<T>(text: string, patterns: [T, RegExp][]): T[] {
  return patterns.filter(([, re]) => re.test(text)).map(([label]) => label);
}

/** Cechy z opisu kwoty podanego przez model („abonament miesięczny netto”). */
export function labelsOfContext(context: string): AmountLabels {
  return {
    tax: new Set(labelsIn(context, TAX_PATTERNS)),
    period: new Set(labelsIn(context, PERIOD_PATTERNS)),
  };
}

/**
 * Cechy kwot w dokumencie: słowa tuż po liczbie (do następnej liczby, maks. 40 znaków:
 * „12 300,00 PLN netto”, „890 USD miesięcznie”), a gdy tam ich nie ma, tuż przed nią
 * (od poprzedniej liczby, maks. 40 znaków: „abonament miesięczny w wysokości 12 300,00”).
 * Okno kończy się na sąsiedniej liczbie, żeby „(15 129,00 PLN brutto)” nie przypisało
 * „brutto” kwocie 12 300,00 stojącej obok.
 */
export function amountLabels(text: string, style: DecimalStyle): Map<number, AmountLabels> {
  const { rest } = extractDates(text);
  const tokens = parseNumbers(rest, style === 'unknown' ? 'comma' : style).sort(
    (a, b) => a.index - b.index,
  );
  const out = new Map<number, AmountLabels>();
  tokens.forEach((token, i) => {
    const end = token.index + token.raw.length;
    const next = tokens[i + 1]?.index ?? rest.length;
    const prevToken = tokens[i - 1];
    const prev = prevToken ? prevToken.index + prevToken.raw.length : 0;
    const after = rest.slice(end, Math.min(next, end + 40));
    const before = rest.slice(Math.max(prev, token.index - 40), token.index);
    const pick = <T>(patterns: [T, RegExp][]) => {
      const found = labelsIn(after, patterns);
      return found.length > 0 ? found : labelsIn(before, patterns);
    };
    const entry = out.get(token.value) ?? { tax: new Set(), period: new Set() };
    for (const l of pick(TAX_PATTERNS)) entry.tax.add(l);
    for (const l of pick(PERIOD_PATTERNS)) entry.period.add(l);
    out.set(token.value, entry);
  });
  return out;
}

export interface LabelMismatch {
  kind: 'tax' | 'period';
  model: string;
  document: string[];
}

/**
 * Czy opis kwoty od modelu przeczy temu, co stoi przy tej liczbie w dokumencie
 * (np. model: „brutto”, dokument przy tej liczbie: tylko „netto”). Brak informacji
 * po którejś stronie to brak zarzutu, a nie błąd.
 */
export function checkLabels(value: number, context: string, ev: Evidence): LabelMismatch[] {
  const doc = ev.labels.get(round2(Math.abs(value)));
  if (!doc) return [];
  const model = labelsOfContext(context);
  const out: LabelMismatch[] = [];
  for (const kind of ['tax', 'period'] as const) {
    const said = [...model[kind]];
    const inDoc = [...doc[kind]] as string[];
    if (said.length !== 1 || inDoc.length === 0) continue;
    const [label] = said as [string];
    if (!inDoc.includes(label)) out.push({ kind, model: label, document: inDoc });
  }
  return out;
}

export interface Evidence {
  style: DecimalStyle;
  /** Cechy kwot (netto/brutto, miesięcznie/rocznie) zapisane przy liczbach w dokumencie. */
  labels: Map<number, AmountLabels>;
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
  const labels = amountLabels(clean, style);
  for (const [value, l] of amountLabels(joined, style)) {
    const entry = labels.get(value) ?? { tax: new Set(), period: new Set() };
    for (const x of l.tax) entry.tax.add(x);
    for (const x of l.period) entry.period.add(x);
    labels.set(value, entry);
  }
  return { style, labels, numbers, money, folded, injectedMoney, injectedNumbers, injectedDates };
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
