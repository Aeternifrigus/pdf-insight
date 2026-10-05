import { describe, expect, it } from 'vitest';
import { en, pl } from '../i18n/messages';
import { planChunks, translateWholeDocument } from './documentTranslation';
import { buildSummaryMarkdown, buildTranslatedDocumentMarkdown, escapeMd } from './exportMarkdown';
import { sampleInsight } from './fixtures';
import { formatDate, formatMoney } from './format';

const plain = (s: string) => s.replace(/\s/g, ' ');

describe('formatowanie zależne od języka (przecinek vs kropka)', () => {
  it('formatuje kwoty i daty po polsku i po angielsku', () => {
    expect(plain(formatMoney(184500, 'PLN', 'pl-PL'))).toBe('184 500,00 zł');
    expect(plain(formatMoney(184500, 'PLN', 'en-GB'))).toBe('PLN 184,500.00');
    expect(plain(formatMoney(8600, 'EUR', 'pl-PL'))).toBe('8600,00 €');
    expect(plain(formatMoney(8600, 'EUR', 'en-GB'))).toBe('€8,600.00');
    expect(formatDate('2026-10-12', 'pl-PL')).toBe('12 października 2026');
    expect(formatDate('2026-10-12', 'en-GB')).toBe('12 October 2026');
  });
});

describe('buildSummaryMarkdown', () => {
  it('eksport polski ma polskie nagłówki i polski zapis liczb', () => {
    const md = plain(buildSummaryMarkdown(sampleInsight(), 'pl'));
    expect(md).toContain('## Podsumowanie');
    expect(md).toContain('| 184 500,00 zł |');
    expect(md).toContain('- 12 marca 2026: zawarcie umowy');
  });

  it('eksport angielski ma angielskie nagłówki i angielski zapis liczb', () => {
    const insight = sampleInsight();
    insight.analysis.translation = {
      from: 'pl',
      to: 'en',
      model: 'm',
      createdAt: '2026-10-05T12:00:00Z',
      numbersVerified: true,
      issues: [],
    };
    const md = plain(buildSummaryMarkdown(insight, 'en'));
    expect(md).toContain('## Summary');
    expect(md).toContain('| PLN 184,500.00 |');
    expect(md).toContain('- 12 March 2026:');
    expect(md).toContain('> Machine translation from Polish');
  });

  it('escapuje treść dokumentu (bez linków, obrazków i HTML w eksporcie)', () => {
    expect(escapeMd('![x](https://evil.example/p.png) <img src=x>')).toBe(
      '\\!\\[x\\]\\(https://evil.example/p.png\\) \\<img src=x\\>',
    );
    expect(escapeMd('1. punkt')).toBe('1\\. punkt');
    expect(escapeMd('a | b')).toBe('a \\| b');
  });
});

describe('buildTranslatedDocumentMarkdown', () => {
  it('ma strony, zachowane wiersze i listę problemów z liczbami', () => {
    const md = buildTranslatedDocumentMarkdown(
      {
        from: 'pl',
        to: 'en',
        model: 'm',
        createdAt: '2026-10-05T12:00:00Z',
        pages: [{ page: 1, text: 'Line one\nLine two' }],
        issues: [{ field: 'page 1', missing: ['184500'], extra: [], wrongFormat: ['184 500,00'] }],
        scannedPages: [11],
      },
      { fileName: 'umowa.pdf', title: 'Framework Agreement' },
    );
    expect(md).toContain('## Page 1');
    expect(md).toContain('Line one  \nLine two');
    expect(md).toContain('page 1: missing 184500; wrong notation "184 500,00"');
    expect(md).toContain('Scanned pages');
  });
});

describe('planChunks', () => {
  it('grupuje strony do limitu, dzieli długie strony i pomija puste', () => {
    const chunks = planChunks(
      {
        pages: [
          { page: 1, text: 'a'.repeat(40) },
          { page: 2, text: 'b'.repeat(40) },
          { page: 3, text: '' },
          { page: 4, text: `${'c'.repeat(60)}\n${'d'.repeat(60)}` },
          { page: 5, text: '' },
        ],
        images: [{ page: 5, mimeType: 'image/jpeg', data: 'A' }],
      },
      100,
      2,
    );
    expect(chunks.map((c) => c.pages.map((p) => p.page))).toEqual([[1, 2], [4], [4], [5]]);
    expect(chunks.at(-1)?.images).toHaveLength(1);
  });
});

describe('translateWholeDocument', () => {
  const doc = {
    pages: [
      { page: 1, text: 'Strona pierwsza' },
      { page: 2, text: 'Strona druga' },
    ],
    images: [],
  };

  it('przy limicie zapytań czeka i ponawia fragment', async () => {
    let calls = 0;
    const waits: number[] = [];
    const out = await translateWholeDocument(doc, 'pl', 'en', {
      signal: new AbortController().signal,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      translateChunk: (req) => {
        calls++;
        if (calls === 1) {
          return Promise.reject(
            Object.assign(new Error('rate'), { code: 'AI_RATE_LIMITED', retryAfterSeconds: 7 }),
          );
        }
        return Promise.resolve({
          pages: req.pages.map((p) => ({ page: p.page, text: `EN ${String(p.page)}` })),
          issues: [],
          model: 'm',
        });
      },
    });
    expect(waits).toEqual([7000]);
    expect(out.pages).toEqual([
      { page: 1, text: 'EN 1' },
      { page: 2, text: 'EN 2' },
    ]);
  });

  it('nie ponawia innych błędów', async () => {
    await expect(
      translateWholeDocument(doc, 'pl', 'en', {
        signal: new AbortController().signal,
        translateChunk: () =>
          Promise.reject(Object.assign(new Error('refused'), { code: 'AI_REFUSED' })),
      }),
    ).rejects.toMatchObject({ code: 'AI_REFUSED' });
  });
});

describe('słowniki PL/EN', () => {
  const keys = (o: object, prefix = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? keys(v as object, `${prefix}${k}.`)
        : [`${prefix}${k}`],
    );

  it('mają te same klucze', () => {
    expect(keys(en).sort()).toEqual(keys(pl).sort());
  });
});
