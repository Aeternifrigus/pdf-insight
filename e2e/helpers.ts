import { expect, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { sampleInsight } from '../src/lib/fixtures';
import {
  analyzeRequestSchema,
  translateDocumentRequestSchema,
  translateRequestSchema,
  type AnalyzeRequest,
  type Insight,
  type TranslateDocumentRequest,
  type TranslateRequest,
} from '../src/lib/schema';

export const API = 'https://api.e2e.test';
export const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname;

const CORS = { 'Access-Control-Allow-Origin': '*' };

export function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: CORS,
    body: JSON.stringify(body),
  });
}

/** Przykładowe tłumaczenie wyniku z fixtures (liczby w zapisie angielskim). */
export function englishInsight(
  overrides: Partial<Insight['analysis']['translation']> = {},
): Insight {
  const pl = sampleInsight();
  return {
    ...pl,
    summary:
      'The agreement concerns the implementation of a CRM system for Nordwave Logistics. The Contractor is Kwadrat Software S.A. The implementation fee is PLN 184,500.00 net.',
    keyPoints: ['Agreement term of 24 months', 'Go-live on 12 October 2026', 'SLA of 99.5%'],
    amounts: pl.amounts.map((a) => ({ ...a, context: 'net implementation fee' })),
    dates: pl.dates.map((d) => ({ ...d, context: 'conclusion of the agreement' })),
    keywords: ['CRM', 'SLA', 'implementation'],
    analysis: {
      ...pl.analysis,
      translation: {
        from: 'pl',
        to: 'en',
        model: 'test-model',
        createdAt: '2026-10-05T12:00:00.000Z',
        numbersVerified: true,
        issues: [],
        ...overrides,
      },
    },
  };
}

export interface ApiMock {
  analyze: AnalyzeRequest[];
  translate: TranslateRequest[];
  translateDocument: TranslateDocumentRequest[];
}

/**
 * Mock backendu. Każde żądanie frontendu jest walidowane tym samym schematem co na serwerze,
 * więc test nie przejdzie, jeśli frontend wyśle coś, czego backend by nie przyjął.
 */
export async function mockApi(
  page: Page,
  handlers: {
    analyze?: (route: Route) => Promise<void>;
    translate?: (route: Route, req: TranslateRequest) => Promise<void>;
    translateDocument?: (route: Route, req: TranslateDocumentRequest) => Promise<void>;
  } = {},
): Promise<ApiMock> {
  const calls: ApiMock = { analyze: [], translate: [], translateDocument: [] };
  await page.route(`${API}/analyze`, async (route) => {
    calls.analyze.push(analyzeRequestSchema.parse(route.request().postDataJSON()));
    if (handlers.analyze) return handlers.analyze(route);
    return fulfillJson(route, sampleInsight());
  });
  await page.route(`${API}/translate`, async (route) => {
    const req = translateRequestSchema.parse(route.request().postDataJSON());
    calls.translate.push(req);
    if (handlers.translate) return handlers.translate(route, req);
    return fulfillJson(route, englishInsight());
  });
  await page.route(`${API}/translate-document`, async (route) => {
    const req = translateDocumentRequestSchema.parse(route.request().postDataJSON());
    calls.translateDocument.push(req);
    if (handlers.translateDocument) return handlers.translateDocument(route, req);
    return fulfillJson(route, {
      pages: req.pages.map((p) => ({
        page: p.page,
        text: `Translated page ${String(p.page)}\nInvoice total: PLN 12,345.67`,
      })),
      issues: [],
      model: 'test-model',
    });
  });
  return calls;
}

export async function upload(page: Page, name: string) {
  await page.locator('input[type=file]').setInputFiles(fixture(name));
}

export async function downloadOf(page: Page, click: () => Promise<void>) {
  const pending = page.waitForEvent('download');
  await click();
  const download = await pending;
  const path = await download.path();
  expect(path).toBeTruthy();
  return { name: download.suggestedFilename(), text: readFileSync(path, 'utf8') };
}
