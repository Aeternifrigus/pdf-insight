import { describe, expect, it } from 'vitest';
import { sampleInsight } from '../../src/lib/fixtures';
import { insightSchema, type TranslatableTexts } from '../../src/lib/schema';
import type { Env } from './env';
import type { LlmClient, Turn } from './llm';
import { handle } from './router';
import { translateDocumentChunk, translateInsight } from './translate';

class FakeLlm implements LlmClient {
  readonly model = 'fake-model';
  calls: Turn[][] = [];
  constructor(private readonly replies: string[]) {}
  complete(_system: string, turns: Turn[]): Promise<string> {
    this.calls.push([...turns]);
    const r = this.replies.shift();
    return r === undefined ? Promise.reject(new Error('no reply')) : Promise.resolve(r);
  }
}

const english: TranslatableTexts = {
  title: 'Framework Agreement No. 14/2026',
  summary:
    'The agreement concerns the implementation of a CRM system for Nordwave Logistics. The Contractor is Kwadrat Software S.A. The implementation fee is PLN 184,500.00 net.',
  keyPoints: ['Agreement term of 24 months', 'Go-live on 12 October 2026', 'SLA of 99.5%'],
  amountContexts: ['net implementation fee'],
  dateContexts: ['conclusion of the agreement'],
  keywords: ['CRM', 'SLA', 'implementation'],
  warnings: [],
};

const source = () => {
  const i = sampleInsight();
  i.document.title = 'Umowa ramowa nr 14/2026';
  return i;
};

describe('translateInsight', () => {
  it('tłumaczy teksty, a liczby, waluty i daty kopiuje z oryginału', async () => {
    const llm = new FakeLlm([JSON.stringify(english)]);
    const out = await translateInsight(source(), 'en', llm);
    expect(insightSchema.safeParse(out).success).toBe(true);
    expect(out.summary).toContain('PLN 184,500.00');
    expect(out.amounts[0]).toMatchObject({
      value: 184500,
      currency: 'PLN',
      context: 'net implementation fee',
    });
    expect(out.dates[0]).toMatchObject({
      date: '2026-03-12',
      context: 'conclusion of the agreement',
    });
    expect(out.document.language).toBe('pl');
    expect(out.entities).toEqual(source().entities);
    expect(out.analysis.translation).toMatchObject({
      from: 'pl',
      to: 'en',
      numbersVerified: true,
      issues: [],
    });
  });

  it('polski zapis liczb w angielskim tekście ("184 500,00", "99,5%") wymusza poprawkę', async () => {
    const leaked = {
      ...english,
      summary: english.summary.replace('PLN 184,500.00', 'PLN 184 500,00'),
      keyPoints: ['Agreement term of 24 months', 'Go-live on 12 October 2026', 'SLA of 99,5%'],
    };
    const llm = new FakeLlm([JSON.stringify(leaked), JSON.stringify(english)]);
    const out = await translateInsight(source(), 'en', llm);
    expect(llm.calls).toHaveLength(2);
    const retry = llm.calls[1]?.at(-1)?.text ?? '';
    expect(retry).toContain('wrong notation');
    expect(retry).toContain('"184 500,00"');
    expect(out.analysis.translation?.numbersVerified).toBe(true);
  });

  it('gdy liczby nadal się nie zgadzają, zwraca tłumaczenie z jawnie oznaczonymi problemami', async () => {
    const wrong = { ...english, summary: english.summary.replace('184,500.00', '184,000.00') };
    const llm = new FakeLlm([JSON.stringify(wrong), JSON.stringify(wrong)]);
    const out = await translateInsight(source(), 'en', llm);
    expect(out.analysis.translation?.numbersVerified).toBe(false);
    expect(out.analysis.translation?.issues[0]).toMatchObject({
      field: 'summary',
      missing: ['184500'],
      extra: ['184000'],
    });
    // Wartości w JSON nadal pochodzą z oryginału.
    expect(out.amounts[0]?.value).toBe(184500);
  });

  it('odrzuca tłumaczenie z inną liczbą punktów także po ponownej próbie', async () => {
    const short = { ...english, keyPoints: english.keyPoints.slice(0, 2) };
    const llm = new FakeLlm([JSON.stringify(short), JSON.stringify(short)]);
    await expect(translateInsight(source(), 'en', llm)).rejects.toMatchObject({
      code: 'INVALID_AI_RESPONSE',
    });
  });

  it('nie tłumaczy na język dokumentu', async () => {
    await expect(translateInsight(source(), 'pl', new FakeLlm([]))).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});

describe('translateDocumentChunk', () => {
  const req = {
    target: 'en' as const,
    sourceLanguage: 'pl',
    pages: [
      { page: 1, text: 'Wynagrodzenie: 184 500,00 zł netto.\nTermin: 12.03.2026 r.' },
      { page: 2, text: '' },
    ],
    images: [{ page: 2, mimeType: 'image/jpeg' as const, data: 'AAAA' }],
  };

  it('tłumaczy strony, sprawdza liczby na stronach z tekstem i pomija skany', async () => {
    const reply = {
      pages: [
        { page: 1, text: 'Fee: PLN 184,500.00 net.\nDeadline: 12 March 2026.' },
        { page: 2, text: 'Annex No. 1, signed on 20 March 2026.' },
      ],
    };
    const llm = new FakeLlm([JSON.stringify(reply)]);
    const out = await translateDocumentChunk(req, llm);
    expect(out.pages).toEqual(reply.pages);
    expect(out.issues).toEqual([]);
    expect(llm.calls[0]?.[0]?.images).toHaveLength(1);
  });

  it('zgłasza zmienioną kwotę na stronie', async () => {
    const bad = {
      pages: [
        { page: 1, text: 'Fee: PLN 18,450.00 net.\nDeadline: 12 March 2026.' },
        { page: 2, text: 'Annex.' },
      ],
    };
    const out = await translateDocumentChunk(
      req,
      new FakeLlm([JSON.stringify(bad), JSON.stringify(bad)]),
    );
    expect(out.issues).toEqual([
      { field: 'page 1', missing: ['184500'], extra: ['18450'], wrongFormat: [] },
    ]);
  });

  it('odrzuca odpowiedź z inną listą stron', async () => {
    const one = { pages: [{ page: 1, text: 'Fee: PLN 184,500.00 net. 12 March 2026' }] };
    await expect(
      translateDocumentChunk(req, new FakeLlm([JSON.stringify(one), JSON.stringify(one)])),
    ).rejects.toMatchObject({ code: 'INVALID_AI_RESPONSE' });
  });
});

describe('POST /translate', () => {
  const env: Env = { ALLOWED_ORIGINS: 'https://example.github.io', GEMINI_API_KEY: '' };
  const post = (path: string, body: unknown) =>
    new Request(`https://api.test${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://example.github.io',
        'CF-Connecting-IP': '198.51.100.7',
      },
      body: JSON.stringify(body),
    });

  it('waliduje żądanie i nie tłumaczy wyniku, który już jest tłumaczeniem', async () => {
    const translated = sampleInsight();
    translated.analysis.translation = {
      from: 'pl',
      to: 'en',
      model: 'x',
      createdAt: '2026-10-05T12:00:00Z',
      numbersVerified: true,
      issues: [],
    };
    const res = await handle(post('/translate', { target: 'en', insight: translated }), env);
    expect(res.status).toBe(400);
    const bad = await handle(post('/translate-document', { target: 'de', pages: [] }), env);
    expect(bad.status).toBe(400);
  });
});
