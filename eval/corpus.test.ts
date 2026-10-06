import { mkdirSync, writeFileSync } from 'node:fs';
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

const api = process.env.LIVE_API?.replace(/\/+$/, '');
const origin = process.env.LIVE_ORIGIN ?? 'https://aeternifrigus.github.io';
/** Odstęp między zapytaniami: limit API to 10 analiz na minutę na adres IP. */
const GAP_MS = Number(process.env.LIVE_GAP_MS ?? 7_000);

if (!api) {
  describe.skip('Faktury open source na żywym API (ustaw LIVE_API)', () => {
    it('pominięte', () => undefined);
  });
} else {
  describe('Faktury open source na żywym API', () => {
    it(
      `analizuje ${String(corpus.length)} faktur i porównuje ze wzorcem`,
      async () => {
        const scores: Score[] = [];
        const outDir = new URL('./results/', import.meta.url).pathname;
        mkdirSync(outDir, { recursive: true });
        for (const [i, t] of corpus.entries()) {
          if (i > 0) await new Promise((r) => setTimeout(r, GAP_MS));
          const pages = await readPdfPages(t.pdf);
          const request = analyzeRequestSchema.parse({
            fileName: `${t.name}.pdf`,
            pageCount: pages.length,
            pages,
            images: [],
            unreadPages: [],
          });
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
          process.stdout.write(`${t.name}: ${(ms / 1000).toFixed(1)} s\n`);
        }
        const report = reportMarkdown(scores, new Date().toISOString());
        writeFileSync(`${outDir}invoices.md`, report);
        process.stdout.write(`\n${report}\n`);
        expect(scores).toHaveLength(corpus.length);
      },
      30 * 60_000,
    );
  });
}
