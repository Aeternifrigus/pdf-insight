import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { formFieldLines } from '../src/lib/forms';
import { buildEvidence, checkAmount, checkDate, checkLabels } from '../src/lib/grounding';
import { detectInjection } from '../src/lib/injection';
import { joinTextItems, type TextItemLike } from '../src/lib/textItems';
import { TEST_CONTRACT } from './facts';

/**
 * Czy model w ogóle dostaje fakty, których oczekujemy? Ten test czyta plik testowy tą samą
 * logiką co aplikacja (składanie tekstu z pdf.js, pola formularzy) i sprawdza, że wszystkie
 * wymagane kwoty i daty ze stron tekstowych są w tekście, skan aneksu trafi do modelu jako
 * obraz, a ukryte polecenie jest wykrywane.
 *   TEST_PDF=/ścieżka/Test_PDF_Insight_umowa_14-2026.pdf npm run check:facts
 * Pliku z rekrutacji nie ma w repozytorium, więc bez TEST_PDF test jest pomijany.
 */
const file = process.env.TEST_PDF;

/** Zapisy kwot i dat w dokumencie: "184 500,00", "8 600", "12.03.2026", "1 kwietnia 2026". */
const MONTHS = [
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
function amountForms(value: number): string[] {
  const [int = '', dec] = value.toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return [`${grouped},${dec ?? '00'}`, grouped];
}
function dateForms(iso: string): string[] {
  const [y = '', m = '', d = ''] = iso.split('-');
  return [`${d}.${m}.${y}`, `${String(Number(d))} ${MONTHS[Number(m) - 1] ?? ''} ${y}`];
}

if (!file) {
  describe.skip('Odczyt pliku testowego (ustaw TEST_PDF)', () => {
    it('pominięte', () => undefined);
  });
} else
  describe('Odczyt pliku testowego (to, co trafia do modelu)', async () => {
    const pdf = await getDocument({ data: new Uint8Array(readFileSync(file)) }).promise;
    const pages: { page: number; text: string }[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const text = joinTextItems(
        content.items.filter((i): i is TextItemLike & typeof i => 'str' in i),
      );
      const fields = formFieldLines((await page.getAnnotations()) as unknown[]);
      pages.push({ page: n, text: fields.length ? `${text}\n${fields.join('\n')}` : text });
    }
    const all = pages.map((p) => p.text).join('\n');

    it(`ma ${String(TEST_CONTRACT.document.pages)} stron`, () => {
      expect(pdf.numPages).toBe(TEST_CONTRACT.document.pages);
    });

    for (const a of TEST_CONTRACT.requiredAmounts.filter((x) => !x.scanned)) {
      it(`tekst zawiera kwotę ${String(a.value)} ${a.currency} (${a.what})`, () => {
        expect(amountForms(a.value).some((f) => all.includes(f))).toBe(true);
      });
    }
    for (const d of TEST_CONTRACT.requiredDates.filter((x) => !x.scanned)) {
      it(`tekst zawiera datę ${d.date} (${d.what})`, () => {
        expect(dateForms(d.date).some((f) => all.includes(f))).toBe(true);
      });
    }

    it('strona 11 (aneks) nie ma warstwy tekstowej, więc trafi do modelu jako obraz', () => {
      const scan = pages.find((p) => p.page === 11);
      expect((scan?.text ?? 'x'.repeat(99)).replace(/\s/g, '').length).toBeLessThan(30);
    });

    it(`ukryte polecenie jest wykrywane na stronie ${String(TEST_CONTRACT.injection.page)}`, () => {
      expect(detectInjection(pages).map((f) => f.page)).toEqual([TEST_CONTRACT.injection.page]);
    });

    it('polskie znaki nie są rozbite (np. „wcześniejsze”, „nieważna”)', () => {
      expect(all).toContain('wcześniejsze');
      expect(all).not.toMatch(/wcze ś/);
    });

    // Kontrola wartości w aplikacji na prawdziwym dokumencie: bez fałszywych alarmów dla prawdy,
    // z alarmem dla wartości z ukrytego polecenia i przeliczonej waluty.
    const textPages = pages.filter((p) => p.page !== 11);
    const ev = buildEvidence(textPages, 'pl');

    for (const a of TEST_CONTRACT.requiredAmounts.filter((x) => !x.scanned)) {
      it(`kontrola w aplikacji potwierdza ${String(a.value)} ${a.currency}`, () => {
        expect(checkAmount(a.value, a.currency, ev)).toBe('ok');
      });
    }
    it('kontrola w aplikacji potwierdza wszystkie daty ze stron tekstowych', () => {
      const dates = TEST_CONTRACT.allDates.filter((d) => checkDate(d, ev) !== 'ok');
      // Daty tylko ze skanu (aneks) nie mogą zostać potwierdzone z tekstu.
      expect(dates).toEqual(['2027-04-01']);
    });
    it('kontrola w aplikacji oznacza 1 PLN z ukrytego polecenia', () => {
      expect(checkAmount(1, 'PLN', ev)).toBe('fromInstruction');
    });
    it('kontrola w aplikacji oznacza licencje 8 600 i hosting 890 podane w PLN', () => {
      expect(checkAmount(8600, 'PLN', ev)).toBe('currencyMismatch');
      expect(checkAmount(890, 'PLN', ev)).toBe('currencyMismatch');
    });

    it('kontrola w aplikacji nie zgłasza fałszywych alarmów dla żadnej kwoty z dokumentu', () => {
      const flagged = Object.entries(TEST_CONTRACT.allAmounts).flatMap(([currency, values]) =>
        values
          .map((value) => ({ value, currency, result: checkAmount(value, currency, ev) }))
          .filter((x) => x.result !== 'ok')
          .map((x) => `${String(x.value)} ${x.currency}: ${x.result}`),
      );
      // 13 100 PLN jest tylko na skanie aneksu, więc tekst nie może go potwierdzić.
      expect(flagged).toEqual(['13100 PLN: notInText']);
    });

    // Kontrola opisów kwot (netto/brutto, okres) na prawdziwym dokumencie.
    const CORRECT_LABELS: [number, string][] = [
      [184500, 'wynagrodzenie za wdrożenie netto'],
      [226935, 'wynagrodzenie za wdrożenie brutto'],
      [12300, 'abonament miesięczny netto'],
      [15129, 'abonament miesięczny brutto'],
      [8600, 'licencje rocznie, 4 instancje'],
      [2150, 'licencja za jedną instancję rocznie'],
      [890, 'hosting miesięcznie'],
      [240, 'stawka netto za roboczogodzinę'],
      [60000, 'limit prac dodatkowych netto rocznie'],
      [250000, 'budżet projektu netto'],
    ];
    it('poprawne opisy kwot nie dają fałszywych alarmów', () => {
      const flagged = CORRECT_LABELS.filter(([v, ctx]) => checkLabels(v, ctx, ev).length > 0);
      expect(flagged).toEqual([]);
    });
    it('zamienione netto/brutto i okres są oznaczane', () => {
      expect(checkLabels(184500, 'wynagrodzenie za wdrożenie brutto', ev)).toMatchObject([
        { kind: 'tax', model: 'gross', document: ['net'] },
      ]);
      expect(checkLabels(226935, 'wynagrodzenie netto', ev)).toMatchObject([
        { kind: 'tax', model: 'net' },
      ]);
      expect(checkLabels(12300, 'abonament roczny netto', ev)).toMatchObject([
        { kind: 'period', model: 'yearly', document: ['monthly'] },
      ]);
      expect(checkLabels(890, 'hosting rocznie', ev)).toMatchObject([{ kind: 'period' }]);
      expect(checkLabels(8600, 'licencje miesięcznie', ev)).toMatchObject([{ kind: 'period' }]);
    });
  });
