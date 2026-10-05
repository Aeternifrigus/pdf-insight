import type { Insight, ModelOutput } from './schema';

/** Przykładowe dane używane w testach jednostkowych. */
export function sampleModelOutput(overrides: Partial<ModelOutput> = {}): ModelOutput {
  return {
    document: {
      language: 'pl',
      type: 'umowa',
      title: 'Umowa ramowa nr 14/2026',
      date: '2026-03-12',
    },
    summary:
      'Umowa dotyczy wdrożenia systemu CRM dla Nordwave Logistics. Wykonawcą jest Kwadrat Software S.A. Wynagrodzenie za wdrożenie wynosi 184 500,00 zł netto.',
    keyPoints: ['Okres umowy 24 miesiące', 'Go-live 12 października 2026', 'SLA 99,5%'],
    entities: {
      organizations: ['Nordwave Logistics sp. z o.o.', 'Kwadrat Software S.A.'],
      people: ['Anna Kowalczyk'],
    },
    amounts: [{ value: 184500, currency: 'PLN', context: 'wynagrodzenie za wdrożenie netto' }],
    dates: [{ date: '2026-03-12', context: 'zawarcie umowy' }],
    keywords: ['CRM', 'SLA', 'wdrożenie'],
    warnings: [],
    ...overrides,
  };
}

export function sampleInsight(): Insight {
  const { warnings, document, ...rest } = sampleModelOutput();
  return {
    ...rest,
    document: { fileName: 'umowa.pdf', pages: 12, ...document },
    analysis: {
      model: 'test-model',
      createdAt: '2026-10-05T12:00:00.000Z',
      chunks: 1,
      ocrPages: [],
      unreadPages: [],
      warnings,
    },
  };
}
