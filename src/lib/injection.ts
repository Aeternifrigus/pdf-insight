import { cleanText } from './textItems';

/**
 * Heurystyczne wykrywanie prób prompt injection w treści PDF.
 * To tylko warstwa sygnalizacyjna: główną ochroną jest to, że treść dokumentu
 * trafia do modelu jako dane w wyraźnie oznaczonym bloku, a wynik jest
 * walidowany schematem. Wykrycie dodaje ostrzeżenie widoczne dla użytkownika.
 */
// Wzorce są zapisane bez polskich znaków, bo tekst jest wcześniej "spłaszczany"
// (ś → s, ł → l), żeby "wczesniejsze" i "wcześniejsze" dawały ten sam wynik.
const PATTERNS: RegExp[] = [
  // PL
  /zignoruj\s+(wszystkie\s+)?(wczesniejsze|poprzednie|powyzsze)\s+(polecenia|instrukcje)/i,
  /instrukcj[aei]\s+dla\s+(systemu\s+)?(ai|sztucznej\s+inteligencji|modelu|asystenta)/i,
  /nie\s+wspominaj\s+o\s+(tej|tych)\s+instrukcj/i,
  // EN
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompts|messages)/i,
  /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompts)/i,
  /(instructions?|note)\s+(for|to)\s+(the\s+)?(ai|assistant|language\s+model|llm|chatgpt|claude)\b/i,
  /you\s+are\s+now\s+(a|an|in)\b/i,
  /\bsystem\s+prompt\b/i,
  // DE
  /ignoriere\s+(alle\s+)?(vorherigen|bisherigen)\s+(anweisungen|befehle)/i,
];

/** Usuwa znaki ukryte i diakrytyczne, ujednolica odstępy. */
export function foldText(text: string): string {
  // Backend nie ufa, że klient wyczyścił tekst, więc czyszczenie jest powtórzone tutaj.
  return cleanText(text)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .replace(/\s+/g, ' ');
}

export interface InjectionFinding {
  page: number;
  excerpt: string;
}

export function detectInjection(pages: { page: number; text: string }[]): InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  for (const { page, text } of pages) {
    const normalized = foldText(text);
    for (const re of PATTERNS) {
      const m = re.exec(normalized);
      if (m) {
        const start = Math.max(0, m.index - 20);
        const excerpt = normalized.slice(start, m.index + m[0].length + 40).trim();
        findings.push({ page, excerpt });
        break;
      }
    }
  }
  return findings;
}

export function injectionWarnings(findings: InjectionFinding[]): string[] {
  return findings.map(
    (f) =>
      `Strona ${f.page}: dokument zawiera tekst wyglądający na polecenie dla systemu AI. ` +
      `Potraktowano go jako zwykłą treść i nie wykonano go.`,
  );
}
