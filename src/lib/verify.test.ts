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
