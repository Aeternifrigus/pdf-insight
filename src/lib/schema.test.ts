import { describe, expect, it } from 'vitest';
import { sampleInsight } from './fixtures';
import { analyzeRequestSchema, insightSchema, isIsoCurrency, isIsoDate } from './schema';

describe('insightSchema', () => {
  it('akceptuje poprawny wynik', () => {
    expect(insightSchema.safeParse(sampleInsight()).success).toBe(true);
  });

  it('wymaga wszystkich pól ze schematu briefu', () => {
    const withoutKeywords: Record<string, unknown> = { ...sampleInsight() };
    delete withoutKeywords.keywords;
    expect(insightSchema.safeParse(withoutKeywords).success).toBe(false);
  });

  it('dopuszcza null dla brakującego tytułu i daty', () => {
    const data = sampleInsight();
    data.document.title = null;
    data.document.date = null;
    expect(insightSchema.safeParse(data).success).toBe(true);
  });

  it('odrzuca nieznany typ dokumentu', () => {
    const data = { ...sampleInsight(), document: { ...sampleInsight().document, type: 'list' } };
    expect(insightSchema.safeParse(data).success).toBe(false);
  });

  it('odrzuca kod języka spoza ISO 639-1', () => {
    const data = sampleInsight();
    data.document.language = 'polski';
    expect(insightSchema.safeParse(data).success).toBe(false);
  });

  it('odrzuca daty w formacie innym niż ISO 8601 i daty nieistniejące', () => {
    for (const date of ['12.03.2026', '2026-02-30', '2026-3-1']) {
      const data = sampleInsight();
      data.dates = [{ date, context: 'test' }];
      expect(insightSchema.safeParse(data).success, date).toBe(false);
    }
  });

  it('odrzuca walutę spoza ISO 4217 i kwotę jako tekst', () => {
    const badCurrency = sampleInsight();
    badCurrency.amounts = [{ value: 10, currency: 'zł', context: 'test' }];
    expect(insightSchema.safeParse(badCurrency).success).toBe(false);

    const badValue = {
      ...sampleInsight(),
      amounts: [{ value: '10', currency: 'PLN', context: 'x' }],
    };
    expect(insightSchema.safeParse(badValue).success).toBe(false);
  });

  it('wymaga od 3 do 7 punktów kluczowych', () => {
    const tooFew = sampleInsight();
    tooFew.keyPoints = ['a', 'b'];
    expect(insightSchema.safeParse(tooFew).success).toBe(false);

    const tooMany = sampleInsight();
    tooMany.keyPoints = Array.from({ length: 8 }, (_, i) => `punkt ${i}`);
    expect(insightSchema.safeParse(tooMany).success).toBe(false);
  });

  it('wymaga podsumowania od 3 do 5 zdań', () => {
    const short = sampleInsight();
    short.summary = 'Jedno zdanie. Drugie zdanie.';
    expect(insightSchema.safeParse(short).success).toBe(false);

    const long = sampleInsight();
    long.summary = 'Raz. Dwa. Trzy. Cztery. Pięć. Sześć.';
    expect(insightSchema.safeParse(long).success).toBe(false);
  });

  it('pozwala na dodatkowe pola, ale nie na usunięcie wymaganych', () => {
    const extra = { ...sampleInsight(), extraField: true };
    expect(insightSchema.safeParse(extra).success).toBe(true);
  });
});

describe('isIsoDate / isIsoCurrency', () => {
  it('rozpoznaje poprawne wartości', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoCurrency('PLN')).toBe(true);
    expect(isIsoCurrency('EUR')).toBe(true);
    expect(isIsoCurrency('pln')).toBe(false);
    expect(isIsoCurrency('XYZ')).toBe(false);
  });
});

describe('analyzeRequestSchema', () => {
  const base = {
    fileName: 'a.pdf',
    pageCount: 1,
    pages: [{ page: 1, text: 'Treść' }],
    images: [],
  };

  it('akceptuje poprawne żądanie', () => {
    expect(analyzeRequestSchema.safeParse(base).success).toBe(true);
  });

  it('odrzuca zbyt długi tekst i za dużo obrazów', () => {
    const longText = { ...base, pages: [{ page: 1, text: 'x'.repeat(400_001) }] };
    expect(analyzeRequestSchema.safeParse(longText).success).toBe(false);

    const img = { page: 1, mimeType: 'image/jpeg', data: 'AAAA' };
    const tooMany = { ...base, images: [img, img, img, img, img] };
    expect(analyzeRequestSchema.safeParse(tooMany).success).toBe(false);
  });

  it('odrzuca obrazy w innym formacie niż JPEG', () => {
    const png = { ...base, images: [{ page: 1, mimeType: 'image/png', data: 'AAAA' }] };
    expect(analyzeRequestSchema.safeParse(png).success).toBe(false);
  });
});
