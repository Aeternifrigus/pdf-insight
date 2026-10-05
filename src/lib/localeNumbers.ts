import { cleanText } from './textItems';

/**
 * Liczby i daty zależne od języka. Polski (i większość języków europejskich) używa przecinka
 * dziesiętnego i spacji (czasem kropki) jako separatora tysięcy: "184 500,00", "12.345,67".
 * Angielski odwrotnie: "184,500.00". Ten sam zapis "12,345" to 12,345 po polsku
 * i 12 345 po angielsku, więc parsowanie bez znajomości stylu ukrywa błędy o czynnik 1000.
 */
export type DecimalStyle = 'comma' | 'point' | 'unknown';

const COMMA_LANGS = new Set([
  'pl',
  'de',
  'cs',
  'sk',
  'fr',
  'es',
  'it',
  'nl',
  'pt',
  'ru',
  'uk',
  'lt',
  'lv',
  'et',
  'sv',
  'da',
  'no',
  'nb',
  'fi',
  'hu',
  'ro',
  'bg',
  'hr',
  'sl',
  'sr',
  'tr',
  'el',
  'id',
]);
const POINT_LANGS = new Set(['en', 'ja', 'zh', 'ko', 'he', 'th', 'hi', 'ms']);

export function decimalStyleForLanguage(lang: string | null | undefined): DecimalStyle {
  if (!lang) return 'unknown';
  const code = lang.toLowerCase().slice(0, 2);
  if (COMMA_LANGS.has(code)) return 'comma';
  if (POINT_LANGS.has(code)) return 'point';
  return 'unknown';
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
  'września',
  'października',
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

const pad = (n: number) => String(n).padStart(2, '0');
const num = (s: string | undefined) => Number(s ?? NaN);

function toIso(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return `${String(y)}-${pad(m)}-${pad(d)}`;
}

function monthIndex(name: string): number {
  const n = name
    .toLowerCase()
    .replace('wrzesnia', 'września')
    .replace('pazdziernika', 'października');
  const pl = PL_MONTHS.indexOf(n);
  if (pl >= 0) return pl + 1;
  const en = EN_MONTHS.indexOf(n);
  return en >= 0 ? en + 1 : -1;
}

const MONTH_ALT = [...PL_MONTHS, 'wrzesnia', 'pazdziernika', ...EN_MONTHS].join('|');
const DATE_PATTERNS: { re: RegExp; parse: (m: string[]) => string | null }[] = [
  // 2026-03-12
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, parse: (m) => toIso(num(m[1]), num(m[2]), num(m[3])) },
  // 12.03.2026 (dzień.miesiąc.rok także w brytyjskim angielskim)
  {
    re: /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g,
    parse: (m) => toIso(num(m[3]), num(m[2]), num(m[1])),
  },
  // 12/03/2026: dzień/miesiąc, chyba że to niemożliwe (03/25/2026 = zapis amerykański)
  {
    re: /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g,
    parse: (m) => {
      const a = num(m[1]);
      const b = num(m[2]);
      return b > 12 ? toIso(num(m[3]), a, b) : toIso(num(m[3]), b, a);
    },
  },
  // 12 marca 2026, 12 March 2026, 12th March, 2026
  {
    re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th|\\.)?\\s+(${MONTH_ALT})\\s*,?\\s+(\\d{4})`, 'gi'),
    parse: (m) => toIso(num(m[3]), monthIndex(m[2] ?? ''), num(m[1])),
  },
  // March 12, 2026
  {
    re: new RegExp(`\\b(${MONTH_ALT})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s+(\\d{4})`, 'gi'),
    parse: (m) => toIso(num(m[3]), monthIndex(m[1] ?? ''), num(m[2])),
  },
];

/** Wyciąga daty (jako ISO) i zwraca tekst z datami zastąpionymi spacjami. */
export function extractDates(text: string): { dates: string[]; rest: string } {
  let rest = cleanText(text);
  const dates: string[] = [];
  for (const { re, parse } of DATE_PATTERNS) {
    rest = rest.replace(re, (match: string, ...args: unknown[]) => {
      // Argumenty po grupach to pozycja i cały tekst.
      const groups = args.slice(0, -2).map((g) => (typeof g === 'string' ? g : ''));
      const iso = parse([match, ...groups]);
      if (!iso) return match;
      dates.push(iso);
      return ' '.repeat(match.length);
    });
  }
  return { dates, rest };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const COMMA_RE = /\d{1,3}(?:[ .]\d{3})+(?:,\d+)?|\d+,\d+|\d+\.\d{1,2}(?![\d.])|\d+/g;
const POINT_RE = /\d{1,3}(?:[, ]\d{3})+(?:\.\d+)?|\d+\.\d+|\d+/g;

function valueComma(raw: string): number {
  if (raw.includes(',')) {
    const [int = '', dec = ''] = raw.split(',');
    return Number(`${int.replace(/[ .]/g, '')}.${dec}`);
  }
  // "1.5" (zapis techniczny) to ułamek, "12.345" to separator tysięcy.
  if (/^\d+\.\d{1,2}$/.test(raw)) return Number(raw);
  return Number(raw.replace(/[ .]/g, ''));
}

function valuePoint(raw: string): number {
  return Number(raw.replace(/[, ]/g, ''));
}

export interface NumberToken {
  raw: string;
  index: number;
  value: number;
}

/** Liczby w tekście według stylu zapisu. Dla 'unknown' zwraca obie interpretacje. */
export function parseNumbers(text: string, style: DecimalStyle): NumberToken[] {
  const scan = (re: RegExp, value: (raw: string) => number): NumberToken[] =>
    [...text.matchAll(re)].flatMap((m) => {
      const v = value(m[0]);
      return Number.isFinite(v) ? [{ raw: m[0], index: m.index, value: round2(v) }] : [];
    });
  if (style === 'comma') return scan(COMMA_RE, valueComma);
  if (style === 'point') return scan(POINT_RE, valuePoint);
  return [...scan(COMMA_RE, valueComma), ...scan(POINT_RE, valuePoint)];
}

/**
 * Styl zapisu liczb wykryty z samego tekstu ("500,00" vs "500.00", "1 234,5" vs "1,234.5").
 * Język wykryty przez model jest tylko podpowiedzią: polska umowa z cennikiem po angielsku
 * powinna być czytana według tego, jak liczby są faktycznie zapisane.
 */
export function detectDecimalStyle(text: string, languageHint?: string | null): DecimalStyle {
  const { rest } = extractDates(text);
  const comma =
    (rest.match(/\d,\d{1,2}(?!\d)/g)?.length ?? 0) +
    2 * (rest.match(/\d{1,3}(?: \d{3})+,\d/g)?.length ?? 0);
  const point =
    (rest.match(/\d\.\d{1,2}(?![\d.])/g)?.length ?? 0) +
    2 * (rest.match(/\d{1,3}(?:,\d{3})+\.\d/g)?.length ?? 0);
  if (comma >= 2 && comma >= 3 * point) return 'comma';
  if (point >= 2 && point >= 3 * comma) return 'point';
  return decimalStyleForLanguage(languageHint);
}

/**
 * Porównanie liczb i dat w tekście źródłowym i jego tłumaczeniu.
 * Tłumaczenie musi zmienić zapis ("184 500,00 zł" → "PLN 184,500.00", "12.03.2026" → "12 March 2026"),
 * ale nie wartości. Zwraca wartości, które zniknęły lub pojawiły się w tłumaczeniu.
 */
export function compareNumericContent(
  source: string,
  sourceStyle: DecimalStyle,
  target: string,
  targetStyle: DecimalStyle,
): { missing: string[]; extra: string[]; wrongFormat: string[] } {
  const side = (text: string, style: DecimalStyle) => {
    const { dates, rest } = extractDates(text);
    const values = parseNumbers(rest, style === 'unknown' ? 'comma' : style).map((t) =>
      String(t.value),
    );
    return [...dates, ...values];
  };
  const count = (items: string[]) => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
    return m;
  };
  const src = count(side(source, sourceStyle));
  const dst = count(side(target, targetStyle));
  const diff = (a: Map<string, number>, b: Map<string, number>) =>
    [...a].flatMap(([k, n]) => Array<string>(Math.max(0, n - (b.get(k) ?? 0))).fill(k));
  return {
    missing: diff(src, dst),
    extra: diff(dst, src),
    wrongFormat: wrongFormat(target, targetStyle),
  };
}

/**
 * Zapisy liczb w złym stylu dla danego języka, np. "184 500,00" albo "99,5%" w tekście
 * angielskim. Taki zapis bywa liczbowo "poprawny" dla parsera, ale czytelnik anglojęzyczny
 * odczyta "1,5" jako 15 albo jako dwie liczby.
 */
export function wrongFormat(text: string, style: DecimalStyle): string[] {
  const { rest } = extractDates(text);
  if (style === 'point') return rest.match(/\d{1,3}(?: \d{3})*,\d{1,2}(?!\d)/g) ?? [];
  if (style === 'comma') return rest.match(/\d{1,3}(?:,\d{3})+\.\d+/g) ?? [];
  return [];
}
