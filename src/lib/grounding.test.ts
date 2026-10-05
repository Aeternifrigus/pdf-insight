import { describe, expect, it } from 'vitest';
import { amountInText, dateInText, foldForSearch, numbersInText } from './grounding';

// Wąska twarda spacja (U+202F) jako separator tysięcy, jak w wielu polskich dokumentach.
const NNBSP = '\u202F';
const doc = `Wynagrodzenie ryczałtowe w wysokości 184 500,00 zł netto, tj. 226${NNBSP}935,00 zł brutto.
Licencje: 8 600 EUR rocznie, hosting 890 USD. Price: 1,234.56 USD. Przychody wzrosną o 4,2 mln zł.
Polska 2 140 58% Niemcy 520 17%. Umowa z dnia 12.03.2026 r., Go-live: 12 października 2026 r.
Signed on March 5, 2026.`;

describe('numbersInText / amountInText', () => {
  const nums = numbersInText(doc);

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
