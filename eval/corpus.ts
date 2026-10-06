import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { foldForSearch } from '../src/lib/grounding';
import type { Insight } from '../src/lib/schema';

/**
 * Zbiór faktur z poprawnymi odpowiedziami z projektu open source invoice2data (licencja MIT,
 * eval/corpus/invoice2data/LICENSE). Faktury po angielsku, francusku, niemiecku i niderlandzku,
 * z USA, Europy i Indii: niezależne od umowy testowej, na której aplikacja była stroiona.
 */
export const CORPUS_DIR = new URL('./corpus/invoice2data/', import.meta.url).pathname;

export interface InvoiceTruth {
  name: string;
  pdf: string;
  issuer: string;
  amount?: number;
  amountUntaxed?: number;
  date?: string;
  invoiceNumber?: string;
  currency?: string;
}

export function loadCorpus(): InvoiceTruth[] {
  return readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const raw =
        (JSON.parse(readFileSync(join(CORPUS_DIR, f), 'utf8')) as Record<string, unknown>[])[0] ??
        {};
      const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
      const name = f.replace(/\.json$/, '');
      return {
        name,
        pdf: join(CORPUS_DIR, `${name}.pdf`),
        issuer: str(raw.issuer) ?? name,
        amount: num(raw.amount),
        amountUntaxed: num(raw.amount_untaxed),
        date: str(raw.date),
        invoiceNumber: str(raw.invoice_number),
        currency: str(raw.currency),
      };
    });
}

export interface Score {
  name: string;
  checks: { label: string; ok: boolean | null }[];
  flagged: number;
  model: string;
  backup: boolean;
  ms: number;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.011;
/** „#BLR_WFLD…” i „BLR_WFLD…” to ten sam numer; porównanie bez znaków niealfanumerycznych. */
const compact = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Porównanie wyniku z poprawnymi odpowiedziami. `null` = brak danej w zbiorze (nie liczone).
 * `flagged` = pozycje oznaczone przez kontrole aplikacji (wartość spoza dokumentu, inna waluta,
 * inny opis), czyli to, co użytkownik zobaczyłby jako „do sprawdzenia”.
 */
export function scoreInvoice(t: InvoiceTruth, r: Insight, ms: number): Score {
  const everything = [r.document.title ?? '', r.summary, ...r.keyPoints, ...r.keywords].join(' ');
  const issuerWord = foldForSearch(t.issuer)
    .split(/[^\p{L}\p{N}]+/u)
    .find((w) => w.length >= 3);
  const checks = [
    { label: 'typ: faktura', ok: r.document.type === 'faktura' },
    {
      label: 'kwota do zapłaty',
      ok: t.amount === undefined ? null : r.amounts.some((a) => near(a.value, t.amount ?? NaN)),
    },
    {
      label: 'waluta kwoty',
      ok:
        t.amount === undefined || !t.currency
          ? null
          : r.amounts.some((a) => near(a.value, t.amount ?? NaN) && a.currency === t.currency),
    },
    {
      label: 'kwota netto',
      ok:
        t.amountUntaxed === undefined || t.amountUntaxed === t.amount
          ? null
          : r.amounts.some((a) => near(a.value, t.amountUntaxed ?? NaN)),
    },
    {
      label: 'data faktury',
      ok:
        t.date === undefined
          ? null
          : r.document.date === t.date || r.dates.some((d) => d.date === t.date),
    },
    {
      label: 'numer faktury',
      ok:
        t.invoiceNumber === undefined
          ? null
          : compact(everything).includes(compact(t.invoiceNumber)),
    },
    {
      label: 'wystawca',
      ok: issuerWord
        ? r.entities.organizations.some((o) => foldForSearch(o).includes(issuerWord)) ||
          foldForSearch(everything).includes(issuerWord)
        : null,
    },
  ];
  const flagged =
    r.amounts.filter((a) => a.foundInText === false || a.issue === 'labelMismatch').length +
    r.dates.filter((d) => d.foundInText === false).length;
  return {
    name: t.name,
    checks,
    flagged,
    model: r.analysis.model,
    backup: r.analysis.backup === true,
    ms,
  };
}

export function reportMarkdown(scores: Score[], when: string): string {
  const labels = scores[0]?.checks.map((c) => c.label) ?? [];
  const cell = (v: boolean | null) => (v === null ? '–' : v ? '✓' : '✗');
  const rows = scores.map(
    (s) =>
      `| ${s.name} | ${s.checks.map((c) => cell(c.ok)).join(' | ')} | ${String(s.flagged)} | ${s.model}${s.backup ? ' (zapasowy)' : ''} | ${(s.ms / 1000).toFixed(1)} s |`,
  );
  const totals = labels.map((label, i) => {
    const vals = scores
      .map((s) => s.checks[i]?.ok)
      .filter((v): v is boolean => v !== null && v !== undefined);
    return `${String(vals.filter(Boolean).length)}/${String(vals.length)}`;
  });
  const ok = scores.flatMap((s) => s.checks.map((c) => c.ok)).filter((v) => v !== null);
  const pct = ok.length ? Math.round((100 * ok.filter(Boolean).length) / ok.length) : 0;
  const times = scores.map((s) => s.ms).sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)] ?? 0;
  return [
    `# Ewaluacja na fakturach open source (invoice2data, MIT)`,
    '',
    `Uruchomienie: ${when}. Dokumenty: ${String(scores.length)}. Zgodność ze wzorcem: ${String(pct)}% sprawdzeń. Mediana czasu analizy: ${(median / 1000).toFixed(1)} s, maksimum: ${((times.at(-1) ?? 0) / 1000).toFixed(1)} s. Pozycje oznaczone przez kontrole aplikacji: ${String(scores.reduce((n, s) => n + s.flagged, 0))}.`,
    '',
    `| Dokument | ${labels.join(' | ')} | Oznaczone | Model | Czas |`,
    `| --- | ${labels.map(() => ':-:').join(' | ')} | :-: | --- | --: |`,
    ...rows,
    `| **Razem** | ${totals.join(' | ')} | | | |`,
    '',
    '✓ zgodne ze wzorcem, ✗ niezgodne lub brak w wyniku, – brak tej danej we wzorcu.',
    '',
  ].join('\n');
}
