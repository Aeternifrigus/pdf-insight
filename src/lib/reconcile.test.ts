import { describe, expect, it } from 'vitest';
import { sampleModelOutput } from './fixtures';
import { reconcileLists } from './reconcile';

describe('spójność podsumowania z listami (bez AI)', () => {
  const keyPoint =
    'Abonament za utrzymanie wynosi 12 300,00 PLN netto miesięcznie do 31 marca 2027 r., a od 1 kwietnia 2027 r. wzrasta do 13 100,00 PLN netto miesięcznie na mocy Aneksu nr 1.';

  it('dopisuje datę i kwotę z punktów, których model nie dał na listy', () => {
    const out = sampleModelOutput({
      keyPoints: [keyPoint, 'Go-live 12 października 2026', 'SLA 99,5%'],
      amounts: [{ value: 12300, currency: 'PLN', context: 'abonament netto' }],
      dates: [{ date: '2026-10-12', context: 'go-live' }],
    });
    const r = reconcileLists(out, out);
    expect(r.dates.map((d) => d.date)).toEqual(
      expect.arrayContaining(['2026-10-12', '2027-03-31', '2027-04-01']),
    );
    expect(r.dates.find((d) => d.date === '2027-04-01')?.context).toBe(
      'a od 1 kwietnia 2027 r. wzrasta do 13 100,00 PLN netto miesięcznie na mocy Aneksu nr 1',
    );
    expect(r.amounts.map((a) => `${String(a.value)} ${a.currency}`)).toEqual(
      expect.arrayContaining(['12300 PLN', '13100 PLN', '184500 PLN']),
    );
  });

  it('nie dubluje wartości, które już są na listach, i nie zmienia ich kolejności', () => {
    const out = sampleModelOutput();
    const r = reconcileLists(out, out);
    expect(r.dates.slice(0, out.dates.length)).toEqual(out.dates);
    expect(r.amounts.filter((a) => a.value === 184500)).toHaveLength(1);
  });
});
