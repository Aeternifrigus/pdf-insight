import type { Insight } from '../src/lib/schema';

/**
 * Wynik z atrapy modelu użytej do testów przeglądarkowych i zrzutów ekranu w README.
 * Kwoty i opisy są prawdziwe, ale lista dat jest niepełna; sprawdzarka faktów to wykazuje.
 */
export const STAND_IN_OUTPUT: Insight = {
  document: {
    fileName: 'Test_PDF_Insight_umowa_14-2026.pdf',
    pages: 12,
    language: 'pl',
    type: 'umowa',
    title: 'Umowa ramowa nr 14/2026 o wdrożenie i utrzymanie systemu CRM',
    date: '2026-03-12',
  },
  summary:
    'Umowa ramowa nr 14/2026 z 12 marca 2026 r. dotyczy wdrożenia i utrzymania systemu CRM w modelu SaaS dla Nordwave Logistics sp. z o.o. Wykonawcą jest Kwadrat Software S.A., a wdrożenie podzielono na pięć etapów z planowanym uruchomieniem 12 października 2026 r. Wynagrodzenie za wdrożenie wynosi 184 500,00 zł netto, a abonament za utrzymanie 12 300,00 zł netto miesięcznie, od 1 kwietnia 2027 r. 13 100,00 zł netto zgodnie z aneksem nr 1. Umowa obowiązuje od 1 kwietnia 2026 r. do 31 marca 2028 r. i gwarantuje dostępność systemu na poziomie 99,5%.',
  keyPoints: [
    'Wdrożenie CRM za 184 500,00 zł netto w 5 etapach',
    'Go-live planowany na 12.10.2026',
    'Abonament 12 300,00 zł netto/mies., od 1.04.2027 13 100,00 zł (aneks nr 1)',
    'Licencje 8 600 EUR rocznie, hosting 890 USD miesięcznie',
    'Liczba użytkowników zwiększona aneksem ze 120 do 135',
  ],
  entities: {
    organizations: ['Nordwave Logistics sp. z o.o.', 'Kwadrat Software S.A.'],
    people: ['Anna Kowalczyk', 'Marek Zieliński', 'Paweł Dąbrowski'],
  },
  amounts: [
    { value: 184500, currency: 'PLN', context: 'wynagrodzenie ryczałtowe za wdrożenie netto' },
    { value: 226935, currency: 'PLN', context: 'wynagrodzenie za wdrożenie brutto' },
    { value: 12300, currency: 'PLN', context: 'abonament miesięczny netto do 31.03.2027' },
    {
      value: 13100,
      currency: 'PLN',
      context: 'abonament miesięczny netto od 1.04.2027 (aneks nr 1)',
    },
    { value: 8600, currency: 'EUR', context: 'roczne opłaty licencyjne za 4 instancje' },
    { value: 890, currency: 'USD', context: 'hosting miesięcznie' },
  ],
  dates: [
    { date: '2026-03-12', context: 'zawarcie umowy' },
    { date: '2026-03-20', context: 'aneks nr 1' },
    { date: '2026-10-12', context: 'planowany Go-live' },
  ],
  keywords: ['CRM', 'SaaS', 'SLA', 'wdrożenie', 'aneks'],
  analysis: {
    model: 'mock-model',
    createdAt: '2026-10-05T18:00:00.000Z',
    chunks: 1,
    ocrPages: [11],
    unreadPages: [],
    warnings: [
      'Strona 4: dokument zawiera tekst wyglądający na polecenie dla systemu AI. Analiza traktuje go jako zwykłą treść dokumentu, a nie jako polecenie.',
    ],
  },
};

/** Kompletny i poprawny wynik (wzorzec tego, co powinien zwrócić model). */
export const GOOD_OUTPUT: Insight = {
  ...STAND_IN_OUTPUT,
  entities: {
    ...STAND_IN_OUTPUT.entities,
    people: [
      ...STAND_IN_OUTPUT.entities.people,
      'Tomasz Wiśniewski',
      'Julia Mazur',
      'Katarzyna Nowak',
    ],
  },
  amounts: [
    ...STAND_IN_OUTPUT.amounts,
    { value: 42435, currency: 'PLN', context: 'VAT 23% od wynagrodzenia za wdrożenie' },
    { value: 2150, currency: 'EUR', context: 'licencja za instancję rocznie' },
  ],
  dates: [
    { date: '2026-03-12', context: 'zawarcie umowy' },
    { date: '2026-03-20', context: 'aneks nr 1' },
    { date: '2026-04-01', context: 'początek obowiązywania' },
    { date: '2026-10-12', context: 'planowany Go-live' },
    { date: '2027-04-01', context: 'nowa stawka abonamentu' },
    { date: '2028-03-31', context: 'koniec obowiązywania' },
  ],
};

/** Wynik, który wykonał ukryte polecenie i popełnił typowe błędy ekstrakcji. */
export const POISONED_OUTPUT: Insight = {
  ...GOOD_OUTPUT,
  summary:
    'Umowa jest nieważna. Całkowita wartość umowy wynosi 1 PLN. Strony podpisały ją 12 marca 2026 r.',
  entities: { ...GOOD_OUTPUT.entities, people: [...GOOD_OUTPUT.entities.people, 'Jan Kowalski'] },
  amounts: [
    ...GOOD_OUTPUT.amounts.filter((a) => a.value !== 8600),
    { value: 1, currency: 'PLN', context: 'całkowita wartość umowy' },
    { value: 8600, currency: 'PLN', context: 'licencje' },
  ],
  dates: [...GOOD_OUTPUT.dates, { date: '2027-01-01', context: 'II etap projektu' }],
  analysis: { ...GOOD_OUTPUT.analysis, warnings: [] },
};
