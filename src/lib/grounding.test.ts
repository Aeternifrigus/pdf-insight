import { describe, expect, it } from 'vitest';
import {
  amountInText,
  buildEvidence,
  checkAmount,
  dateInText,
  foldForSearch,
  numbersInText,
} from './grounding';

// Wąska twarda spacja (U+202F) jako separator tysięcy, jak w wielu polskich dokumentach.
const NNBSP = '\u202F';
const doc = `Wynagrodzenie ryczałtowe w wysokości 184 500,00 zł netto, tj. 226${NNBSP}935,00 zł brutto.
Licencje: 8 600 EUR rocznie, hosting 890 USD. Price: 1,234.56 USD. Przychody wzrosną o 4,2 mln zł.
Polska 2 140 58% Niemcy 520 17%. Umowa z dnia 12.03.2026 r., Go-live: 12 października 2026 r.
Signed on March 5, 2026.`;

describe('numbersInText / amountInText', () => {
  const nums = numbersInText(doc, 'unknown');

  it('rozpoznaje polskie i angielskie zapisy kwot', () => {
    for (const v of [184500, 226935, 8600, 890, 1234.56])
      expect(amountInText(v, nums), String(v)).toBe(true);
  });

  it('uwzględnia mnożniki (mln) i kolumny tabel sklejone spacjami', () => {
    expect(amountInText(4_200_000, nums)).toBe(true);
    expect(amountInText(2140, nums)).toBe(true);
  });

  it('nie znajduje kwoty, której nie ma w dokumencie', () => {
    expect(amountInText(999_999, nums)).toBe(false);
    expect(amountInText(1, nums)).toBe(false);
  });
});

describe('numbersInText: styl zapisu dokumentu', () => {
  it('w polskim tekście "12,345 zł" to 12,345, a nie 12 345 (błąd o czynnik 1000)', () => {
    const nums = numbersInText('Opłata wynosi 12,345 zł.', 'comma');
    expect(amountInText(12.35, nums)).toBe(true);
    expect(amountInText(12345, nums)).toBe(false);
  });

  it('w angielskim tekście "1,234 USD" to 1234, a nie 1,234', () => {
    const nums = numbersInText('Fee: 1,234 USD.', 'point');
    expect(amountInText(1234, nums)).toBe(true);
    expect(amountInText(1.234, nums)).toBe(false);
  });
});

describe('dateInText', () => {
  const folded = foldForSearch(doc);

  it('rozpoznaje zapisy numeryczne i słowne (PL, EN)', () => {
    expect(dateInText('2026-03-12', folded)).toBe(true);
    expect(dateInText('2026-10-12', folded)).toBe(true);
    expect(dateInText('2026-03-05', folded)).toBe(true);
  });

  it('nie znajduje daty spoza dokumentu ani fragmentu innej daty', () => {
    expect(dateInText('2026-05-01', folded)).toBe(false);
    expect(dateInText('2026-03-02', foldForSearch('termin 12.3.2026'))).toBe(false);
  });
});

describe('buildEvidence: liczby przełamane między wierszami', () => {
  it('rozpoznaje kwotę zapisaną jako "(295" i "200,00 zł" w kolejnym wierszu', () => {
    const ev = buildEvidence(
      [{ text: 'abonament 12 300,00 zł/mies. (295\n200,00 zł za 24 miesiące)' }],
      'pl',
    );
    expect(checkAmount(295200, 'PLN', ev)).toBe('ok');
    expect(checkAmount(12300, 'PLN', ev)).toBe('ok');
  });
});
