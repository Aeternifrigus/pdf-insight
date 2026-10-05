import { describe, expect, it } from 'vitest';
import { formFieldLines } from './forms';

describe('formFieldLines', () => {
  it('zwraca wartości wypełnionych pól tekstowych, list i pól wyboru', () => {
    const lines = formFieldLines([
      { subtype: 'Widget', fieldName: 'kwota', fieldValue: '4 250,00 PLN' },
      {
        subtype: 'Widget',
        fieldName: 'data',
        alternativeText: 'Data wniosku',
        fieldValue: '15.09.2026',
      },
      { subtype: 'Widget', fieldName: 'waluta', fieldValue: ['PLN'] },
      { subtype: 'Widget', fieldName: 'zgoda', checkBox: true, fieldValue: 'Yes' },
      { subtype: 'Widget', fieldName: 'rezygnacja', checkBox: true, fieldValue: 'Off' },
      { subtype: 'Widget', fieldName: 'puste', fieldValue: '' },
      { subtype: 'Link', url: 'https://example.com' },
    ]);
    expect(lines).toEqual([
      'kwota: 4 250,00 PLN',
      'Data wniosku: 15.09.2026',
      'waluta: PLN',
      'zgoda: zaznaczone',
    ]);
  });

  it('pomija pola haseł', () => {
    expect(
      formFieldLines([
        { subtype: 'Widget', fieldName: 'pin', fieldValue: '1234', fieldFlags: 1 << 13 },
      ]),
    ).toEqual([]);
  });
});
