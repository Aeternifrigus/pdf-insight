import { describe, expect, it } from 'vitest';
import { sampleInsight } from './fixtures';
import { foldForSearch } from './grounding';
import { groundEntities, nameInText, verifyInsight } from './verify';

const words = (text: string) =>
  new Set(
    foldForSearch(text)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3),
  );

describe('nazwy osób i firm (bez AI)', () => {
  const doc = words(
    'Zamawiający reprezentowany przez Annę Kowalczyk oraz Marka Zielińskiego. Wykonawca: Kwadrat Software S.A., Zamawiający: Nordwave Logistics sp. z o.o.',
  );

  it('znajduje nazwy mimo polskiej odmiany i form prawnych', () => {
    expect(nameInText('Anna Kowalczyk', doc)).toBe(true);
    expect(nameInText('Marek Zieliński', doc)).toBe(true);
    expect(nameInText('Kwadrat Software S.A.', doc)).toBe(true);
    expect(nameInText('Nordwave Logistics Spółka z ograniczoną odpowiedzialnością', doc)).toBe(
      true,
    );
  });

  it('oznacza nazwisko lub firmę wymyśloną przez model', () => {
    expect(nameInText('Piotr Nowak', doc)).toBe(false);
    expect(nameInText('Kowalski Consulting', doc)).toBe(false);
    const warnings = groundEntities(
      { organizations: ['Kwadrat Software S.A.', 'Globex Polska'], people: ['Anna Kowalczyk'] },
      foldForSearch([...doc].join(' ')),
    );
    expect(warnings).toEqual([
      'Tych nazw nie znaleziono w tekście dokumentu, sprawdź je ręcznie: Globex Polska.',
    ]);
  });
});

describe('OCR skanów jako drugie źródło do kontroli wartości', () => {
  const insight = {
    ...sampleInsight(),
    entities: { organizations: [], people: [] },
    amounts: [
      { value: 13100, currency: 'PLN', context: 'abonament od 1.04.2027 (aneks, skan)' },
      { value: 99999, currency: 'PLN', context: 'kwota zmyślona przez model' },
    ],
    dates: [{ date: '2027-04-01', context: 'nowy abonament' }],
  };
  const source = {
    pages: [
      { page: 1, text: 'Umowa ramowa nr 14/2026 zawarta 12.03.2026 r.' },
      { page: 2, text: '' },
    ],
    images: [{ page: 2, mimeType: 'image/jpeg' as const, data: 'AAAA' }],
  };
  const ocr = [
    {
      page: 2,
      text: 'ANEKS NR 1\nod dnia 1 kwietnia 2027 r. w wysokości 13\n100,00 PLN netto.',
    },
  ];

  it('bez OCR wartości ze skanu są oznaczone jako niesprawdzone', () => {
    const out = verifyInsight(insight, source);
    expect(out.amounts.map((a) => a.foundInText)).toEqual([null, null]);
  });

  it('z OCR wartość ze skanu jest potwierdzona, a wymyślona oznaczona', () => {
    const out = verifyInsight(insight, source, ocr);
    expect(out.amounts.map((a) => a.foundInText)).toEqual([true, false]);
    expect(out.dates[0]?.foundInText).toBe(true);
    expect(out.analysis.ocrVerifiedPages).toEqual([2]);
    expect(out.analysis.warnings.join(' ')).toContain('99999 PLN');
  });

  it('pusty odczyt OCR nie jest dowodem na brak wartości', () => {
    const out = verifyInsight(insight, source, [{ page: 2, text: ' . ' }]);
    expect(out.amounts.map((a) => a.foundInText)).toEqual([null, null]);
  });
});

describe('opisy kwot: netto/brutto i okres (bez AI)', () => {
  const source = {
    pages: [
      {
        page: 1,
        text: 'Wynagrodzenie wynosi 184 500,00 zł netto, tj. 226 935,00 zł brutto. Abonament miesięczny w wysokości 12 300,00 PLN netto (15 129,00 PLN brutto). Licencje: 8 600 EUR rocznie.',
      },
    ],
    images: [],
  };
  const base = { ...sampleInsight(), entities: { organizations: [], people: [] } };

  it('poprawne opisy nie są oznaczane', () => {
    const out = verifyInsight(
      {
        ...base,
        summary:
          'Umowa na wdrożenie. Wynagrodzenie to 184 500,00 zł netto. Abonament wynosi 12 300,00 PLN miesięcznie.',
        keyPoints: ['Brutto: 226 935,00 zł brutto', 'Licencje 8 600 EUR rocznie', 'Okres 24 mies.'],
        amounts: [
          { value: 184500, currency: 'PLN', context: 'wdrożenie netto' },
          { value: 15129, currency: 'PLN', context: 'abonament miesięczny brutto' },
          { value: 8600, currency: 'EUR', context: 'licencje rocznie' },
        ],
      },
      source,
    );
    expect(out.amounts.map((a) => a.issue)).toEqual([undefined, undefined, undefined]);
    expect(out.analysis.warnings.join(' ')).not.toMatch(/netto\/brutto/);
  });

  it('kwota z zamienionym opisem jest oznaczona, choć występuje w dokumencie', () => {
    const out = verifyInsight(
      {
        ...base,
        amounts: [
          { value: 184500, currency: 'PLN', context: 'wynagrodzenie za wdrożenie brutto' },
          { value: 12300, currency: 'PLN', context: 'abonament roczny' },
        ],
      },
      source,
    );
    expect(out.amounts.map((a) => [a.foundInText, a.issue])).toEqual([
      [true, 'labelMismatch'],
      [true, 'labelMismatch'],
    ]);
    const warning = out.analysis.warnings.find((w) => w.startsWith('Opis kwoty'));
    expect(warning).toContain('184500 PLN (w wyniku: brutto, w dokumencie: netto)');
    expect(warning).toContain('12300 PLN (w wyniku: rocznie, w dokumencie: miesięcznie)');
  });

  it('podsumowanie z błędnym netto/brutto dostaje ostrzeżenie', () => {
    const out = verifyInsight(
      {
        ...base,
        summary:
          'Umowa na wdrożenie systemu. Łączne wynagrodzenie to 226 935,00 zł netto. Strony to zamawiający i wykonawca.',
        amounts: [],
      },
      source,
    );
    expect(out.analysis.warnings.join(' ')).toContain(
      'Podsumowanie opisuje kwotę inaczej niż dokument (netto/brutto lub okres): 226935 (w wyniku: netto, w dokumencie: brutto).',
    );
  });
});
