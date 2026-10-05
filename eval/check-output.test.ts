import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkFacts } from './factCheck';
import { TEST_CONTRACT } from './facts';

/**
 * Sprawdzarka faktów dla prawdziwego wyniku modelu:
 *   FACTS_JSON=~/Downloads/Test_PDF_Insight_umowa_14-2026.insight.json npm run check:facts
 * Bez zmiennej FACTS_JSON testy są pomijane (np. w `npm test` i w CI).
 */
const file = process.env.FACTS_JSON;

// describe.skipIf nadal wykonuje ciało describe (odczyt pliku), więc plik jest czytany tylko, gdy jest podany.
if (!file) {
  describe.skip('Wynik modelu vs fakty z dokumentu (ustaw FACTS_JSON)', () => {
    it('pominięte', () => undefined);
  });
} else
  describe(`Wynik modelu vs fakty z dokumentu: ${file}`, () => {
    const report = checkFacts(JSON.parse(readFileSync(file, 'utf8')), TEST_CONTRACT);

    it(`Podsumowanie: obowiązkowe ${report.summary.must}, uzupełniające ${report.summary.should}`, () => {
      expect(report.passed).toBe(true);
    });

    for (const c of report.checks) {
      const mark = c.ok ? 'OK ' : c.level === 'must' ? 'BŁĄD' : 'brak';
      const title = `[${c.level === 'must' ? 'MUST' : 'SHOULD'}] ${mark} ${c.label}${c.ok || !c.detail ? '' : ` (${c.detail})`}`;
      // Sprawdzenia uzupełniające są raportowane, ale nie oblewają przebiegu.
      it(title, () => {
        if (c.level === 'must') expect(c.ok, c.detail).toBe(true);
      });
    }
  });
