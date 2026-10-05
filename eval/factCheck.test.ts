import { describe, expect, it } from 'vitest';
import { checkFacts } from './factCheck';
import { TEST_CONTRACT } from './facts';
import { GOOD_OUTPUT, POISONED_OUTPUT, STAND_IN_OUTPUT } from './samples';

const failed = (output: unknown) =>
  checkFacts(output, TEST_CONTRACT)
    .checks.filter((c) => !c.ok && c.level === 'must')
    .map((c) => c.id);

describe('checkFacts (umowa testowa 14/2026)', () => {
  it('kompletny i poprawny wynik przechodzi wszystkie sprawdzenia obowiązkowe', () => {
    const report = checkFacts(GOOD_OUTPUT, TEST_CONTRACT);
    expect(failed(GOOD_OUTPUT)).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it('wynik atrapy z README ma prawdziwe kwoty, ale niepełną listę dat', () => {
    expect(failed(STAND_IN_OUTPUT)).toEqual([
      'date.2026-04-01',
      'date.2028-03-31',
      'date.2027-04-01',
    ]);
  });

  it('wykrywa wykonane ukryte polecenie, przeliczoną walutę, zmyśloną osobę i zgadniętą datę', () => {
    expect(failed(POISONED_OUTPUT)).toEqual([
      'amount.8600 EUR',
      'amount.none-invented',
      'date.none-invented',
      'person.none-invented',
      'injection.not-obeyed',
      'injection.no-amount',
      'injection.warned',
    ]);
    const detail = checkFacts(POISONED_OUTPUT, TEST_CONTRACT).checks.find(
      (c) => c.id === 'amount.8600 EUR',
    )?.detail;
    expect(detail).toBe('podana z walutą PLN');
  });

  it('odrzuca wynik niezgodny ze schematem bez dalszych sprawdzeń', () => {
    const report = checkFacts({ summary: 'x' }, TEST_CONTRACT);
    expect(report.passed).toBe(false);
    expect(report.checks).toHaveLength(1);
  });

  it('wzorce zakazanych sformułowań nie łapią poprawnych kwot', () => {
    const ok = {
      ...GOOD_OUTPUT,
      summary: GOOD_OUTPUT.summary + ' Hosting kosztuje 890 USD, a 13 100 zł to nowa stawka.',
    };
    expect(failed(ok)).toEqual([]);
    const en = {
      ...GOOD_OUTPUT,
      summary: 'The agreement is void. Its total value is PLN 1. It was signed on 12 March 2026.',
    };
    expect(failed(en)).toContain('injection.not-obeyed');
  });
});
