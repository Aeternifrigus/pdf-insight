import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildEvidence, checkAmount, checkDate } from '../src/lib/grounding';
import { analyzeRequestSchema, insightSchema } from '../src/lib/schema';
import { verifyInsight } from '../src/lib/verify';
import { loadCorpus, reportMarkdown, scoreInvoice, type Score } from './corpus';
import { readPdfPages } from './readPdf';

/**
 * Faktury open source (invoice2data, MIT) z poprawnymi odpowiedziami.
 *
 * Część offline (zawsze, w `npm test`): kontrole aplikacji nie zgłaszają fałszywych alarmów
 * dla prawdziwej kwoty i daty żadnej faktury, a zmyśloną kwotę oznaczają. Ten test znalazł
 * błąd: daty po francusku, niderlandzku i skrócone angielskie były zgłaszane jako „spoza dokumentu”.
 *
 * Część na żywo (tylko z LIVE_API): każda faktura idzie do wdrożonego API, wynik przechodzi
 * te same kontrole co w przeglądarce i jest porównany ze wzorcem; raport trafia do eval/results.
 *   LIVE_API=https://pdf-insight-api.<konto>.workers.dev npm run eval:invoices
 *
 * Ponowna ocena zapisanych wyników (bez nowych zapytań do API), np. po poprawce kontroli:
 *   RESCORE=1 npm run eval:invoices
 */
const corpus = loadCorpus();

describe('Faktury open source: kontrole aplikacji bez fałszywych alarmów', () => {
  for (const t of corpus) {
    it(`${t.name}: prawdziwa kwota i data potwierdzone, zmyślona kwota oznaczona`, async () => {
      const ev = buildEvidence(await readPdfPages(t.pdf));
      if (t.amount !== undefined) expect(checkAmount(t.amount, t.currency ?? 'XXX', ev)).toBe('ok');
      if (t.date) expect(checkDate(t.date, ev)).toBe('ok');
      expect(checkAmount(987654.32, t.currency ?? 'EUR', ev)).toBe('notInText');
    });
  }
});

/**
 * Wartości, które model podał poprawnie, a kontrola aplikacji w pierwszym przebiegu na żywo
 * fałszywie oznaczyła (precyzja kontroli). Muszą zostać potwierdzone.
 */
const FORMER_FALSE_ALARMS: { name: string; date?: string; amount?: number; currency?: string }[] = [
  { name: 'AmazonWebServices', date: '2014-07-01' },
  { name: 'FlipkartInvoice', amount: 278.61, currency: 'INR' },
  { name: 'free_fiber', amount: 3441812, currency: 'EUR' },
  { name: 'QualityHosting', date: '2014-05-21' },
];

describe('Faktury open source: dawne fałszywe alarmy kontroli', () => {
  for (const f of FORMER_FALSE_ALARMS) {
    it(`${f.name}: ${f.date ?? `${String(f.amount)} ${f.currency ?? ''}`} jest potwierdzone`, async () => {
      const t = corpus.find((c) => c.name === f.name);
      if (!t) throw new Error(`brak ${f.name}`);
      const ev = buildEvidence(await readPdfPages(t.pdf));
      if (f.date) expect(checkDate(f.date, ev)).toBe('ok');
      if (f.amount !== undefined) expect(checkAmount(f.amount, f.currency ?? 'XXX', ev)).toBe('ok');
    });
  }
});

const api = process.env.LIVE_API?.replace(/\/+$/, '');
const origin = process.env.LIVE_ORIGIN ?? 'https://aeternifrigus.github.io';
/** Odstęp między zapytaniami: limit API to 10 analiz na minutę na adres IP. */
const GAP_MS = Number(process.env.LIVE_GAP_MS ?? 7_000);

const resultsDir = new URL('./results/', import.meta.url).pathname;

function requestFor(name: string, pages: { page: number; text: string }[]) {
  return analyzeRequestSchema.parse({
    fileName: `${name}.pdf`,
    pageCount: pages.length,
    pages,
    images: [],
    unreadPages: [],
  });
}

/** Czasy z przebiegu na żywo: timings.json albo (starsze przebiegi) tabela w invoices.md. */
function savedTimings(): Record<string, number> {
  const json = `${resultsDir}timings.json`;
  if (existsSync(json)) return JSON.parse(readFileSync(json, 'utf8')) as Record<string, number>;
  const md = `${resultsDir}invoices.md`;
  if (!existsSync(md)) return {};
  const out: Record<string, number> = {};
  for (const m of readFileSync(md, 'utf8').matchAll(/^\| (\S+) \|.*\| ([\d.]+) s \|$/gm)) {
    if (m[1] && m[2]) out[m[1]] = Number(m[2]) * 1000;
  }
  return out;
}

if (process.env.RESCORE) {
  describe('Faktury open source: ponowna ocena zapisanych wyników', () => {
    it('przelicza kontrole i raport bez nowych zapytań do API', async () => {
      const timings = savedTimings();
      const scores: Score[] = [];
      for (const t of corpus) {
        const file = `${resultsDir}${t.name}.json`;
        if (!existsSync(file)) continue;
        const request = requestFor(t.name, await readPdfPages(t.pdf));
        const insight = verifyInsight(
          insightSchema.parse(JSON.parse(readFileSync(file, 'utf8'))),
          request,
        );
        writeFileSync(file, JSON.stringify(insight, null, 2));
        scores.push(scoreInvoice(t, insight, timings[t.name] ?? 0));
      }
      const report = reportMarkdown(
        scores,
        `${new Date().toISOString()} (ponowna ocena zapisanych wyników modelu bieżącą wersją kontroli)`,
      );
      writeFileSync(`${resultsDir}invoices.md`, report);
      writeFileSync(`${resultsDir}timings.json`, JSON.stringify(timings, null, 2));
      process.stdout.write(`\n${report}\n`);
      expect(scores.length).toBeGreaterThan(0);
    }, 120_000);
  });
} else if (!api) {
  describe.skip('Faktury open source na żywym API (ustaw LIVE_API)', () => {
    it('pominięte', () => undefined);
  });
} else {
  describe('Faktury open source na żywym API', () => {
    it(
      `analizuje ${String(corpus.length)} faktur i porównuje ze wzorcem`,
      async () => {
        const scores: Score[] = [];
        const timings: Record<string, number> = {};
        const outDir = resultsDir;
        mkdirSync(outDir, { recursive: true });
        for (const [i, t] of corpus.entries()) {
          if (i > 0) await new Promise((r) => setTimeout(r, GAP_MS));
          const pages = await readPdfPages(t.pdf);
          const request = requestFor(t.name, pages);
          const started = Date.now();
          const res = await fetch(`${api}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: origin },
            body: JSON.stringify(request),
          });
          const ms = Date.now() - started;
          const body: unknown = await res.json();
          if (!res.ok)
            throw new Error(`${t.name}: HTTP ${String(res.status)} ${JSON.stringify(body)}`);
          const insight = verifyInsight(insightSchema.parse(body), request);
          writeFileSync(`${outDir}${t.name}.json`, JSON.stringify(insight, null, 2));
          scores.push(scoreInvoice(t, insight, ms));
          timings[t.name] = ms;
          process.stdout.write(`${t.name}: ${(ms / 1000).toFixed(1)} s\n`);
        }
        const report = reportMarkdown(scores, new Date().toISOString());
        writeFileSync(`${outDir}invoices.md`, report);
        writeFileSync(`${outDir}timings.json`, JSON.stringify(timings, null, 2));
        process.stdout.write(`\n${report}\n`);
        expect(scores).toHaveLength(corpus.length);
      },
      30 * 60_000,
    );
  });
}
