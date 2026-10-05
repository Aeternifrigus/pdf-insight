import { describe, expect, it } from 'vitest';
import {
  compareNumericContent,
  detectDecimalStyle,
  extractDates,
  parseNumbers,
} from './localeNumbers';

const values = (text: string, style: 'comma' | 'point') =>
  parseNumbers(text, style).map((t) => t.value);

describe('parseNumbers: przecinek i kropka', () => {
  it('styl polski: przecinek dziesiętny, spacja lub kropka jako tysiące', () => {
    expect(values('184 500,00 zł', 'comma')).toEqual([184500]);
    expect(values('12.345,67 zł', 'comma')).toEqual([12345.67]);
    expect(values('99,5% i 0,2%', 'comma')).toEqual([99.5, 0.2]);
    expect(values('opłata 12,345 zł', 'comma')).toEqual([12.35]);
    expect(values('1.5 GB', 'comma')).toEqual([1.5]);
    expect(values('ok. 3.400 klientów', 'comma')).toEqual([3400]);
  });

  it('styl angielski: kropka dziesiętna, przecinek jako tysiące', () => {
    expect(values('PLN 184,500.00', 'point')).toEqual([184500]);
    expect(values('fee 1,234 USD', 'point')).toEqual([1234]);
    expect(values('99.5%', 'point')).toEqual([99.5]);
    // "1,5" po angielsku to nie półtora: dwie osobne liczby.
    expect(values('1,5 million', 'point')).toEqual([1, 5]);
  });

  it('nie skleja kolumn tabeli, gdy kolejna grupa nie ma trzech cyfr', () => {
    expect(values('Polska 2 140 58%', 'comma')).toEqual([2140, 58]);
  });
});

describe('extractDates', () => {
  it('rozpoznaje zapisy polskie, angielskie i ISO', () => {
    expect(extractDates('z dnia 12.03.2026 r., Go-live 12 października 2026').dates).toEqual([
      '2026-03-12',
      '2026-10-12',
    ]);
    expect(extractDates('signed on 12 March 2026 and March 5, 2026').dates).toEqual([
      '2026-03-12',
      '2026-03-05',
    ]);
    expect(extractDates('2026-02-30 nie istnieje').dates).toEqual([]);
  });
});

describe('detectDecimalStyle', () => {
  it('wykrywa styl z zapisu liczb, a język traktuje jako podpowiedź', () => {
    expect(detectDecimalStyle('184 500,00 zł oraz 12 300,00 zł', 'en')).toBe('comma');
    expect(detectDecimalStyle('USD 1,234.56 and 890.00', 'pl')).toBe('point');
    expect(detectDecimalStyle('Brak kwot w tekście.', 'pl')).toBe('comma');
    expect(detectDecimalStyle('No amounts here.', 'xx')).toBe('unknown');
  });
});

describe('compareNumericContent (tłumaczenie PL → EN)', () => {
  it('zły zapis i zmieniona wartość są raportowane osobno', () => {
    const r = compareNumericContent(
      'Kapitał 2 500 000,00 zł, rabat 0,2%.',
      'comma',
      'Capital PLN 2 500 000,00, discount 0.3%.',
      'point',
    );
    expect(r).toEqual({ missing: ['0.2'], extra: ['0.3'], wrongFormat: ['2 500 000,00'] });
  });

  const pl =
    'Wynagrodzenie wynosi 184 500,00 zł netto, abonament 12 300,00 zł. Dostępność 99,5%. Umowa z 12.03.2026 r.';

  it('akceptuje poprawnie przeformatowane tłumaczenie', () => {
    const en =
      'The fee is PLN 184,500.00 net, the subscription PLN 12,300.00. Availability 99.5%. Agreement of 12 March 2026.';
    expect(compareNumericContent(pl, 'comma', en, 'point')).toEqual({
      missing: [],
      extra: [],
      wrongFormat: [],
    });
  });

  it('wykrywa zapis polski przeniesiony do angielskiego tekstu (1000× błąd)', () => {
    const en =
      'The fee is PLN 184 500,00 net, the subscription PLN 12,300.00. Availability 99,5%. Agreement of 12 March 2026.';
    const r = compareNumericContent(pl, 'comma', en, 'point');
    // Wartości się zgadzają, więc zgłoszony jest tylko zły zapis, bez szumu typu "dodano 0".
    expect(r).toEqual({ missing: [], extra: [], wrongFormat: ['184 500,00', '99,5'] });
  });

  it('wykrywa zmienioną datę i zgubioną kwotę', () => {
    const en = 'The fee is PLN 184,500.00 net. Availability 99.5%. Agreement of 13 March 2026.';
    const r = compareNumericContent(pl, 'comma', en, 'point');
    expect(r.missing).toEqual(expect.arrayContaining(['12300', '2026-03-12']));
    expect(r.extra).toEqual(['2026-03-13']);
  });
});
