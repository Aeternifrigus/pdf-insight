import { z } from 'zod';
import { countSentences } from './sentences';

/**
 * Schemat wyniku analizy (sekcja 04 briefu).
 * Ten sam plik jest importowany przez frontend (walidacja przed wyświetleniem)
 * i przez backend (walidacja odpowiedzi modelu + ponowna próba).
 */

export const DOCUMENT_TYPES = ['faktura', 'umowa', 'oferta', 'raport', 'inne'] as const;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Prawdziwa data kalendarzowa w formacie ISO 8601 (YYYY-MM-DD). */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const FALLBACK_CURRENCIES = new Set([
  'PLN',
  'EUR',
  'USD',
  'GBP',
  'CHF',
  'CZK',
  'SEK',
  'NOK',
  'DKK',
  'HUF',
  'JPY',
  'CNY',
  'INR',
  'CAD',
  'AUD',
  'UAH',
  'RON',
  'BGN',
]);

function currencySet(): Set<string> {
  try {
    return new Set(Intl.supportedValuesOf('currency'));
  } catch {
    return FALLBACK_CURRENCIES;
  }
}
const CURRENCIES = currencySet();

/** Kod waluty ISO 4217 (np. PLN, EUR). */
export function isIsoCurrency(value: string): boolean {
  return /^[A-Z]{3}$/.test(value) && CURRENCIES.has(value);
}

const nonEmpty = z.string().trim().min(1);

export const isoDateSchema = z
  .string()
  .refine(isIsoDate, { message: 'Data musi być w formacie ISO 8601 (YYYY-MM-DD)' });

export const documentSchema = z.object({
  fileName: nonEmpty,
  pages: z.number().int().min(1),
  language: z
    .string()
    .regex(/^[a-z]{2}$/, { message: 'Język musi być kodem ISO 639-1 (np. "pl")' }),
  type: z.enum(DOCUMENT_TYPES),
  title: nonEmpty.nullable(),
  date: isoDateSchema.nullable(),
});

export const summarySchema = nonEmpty.refine(
  (s) => {
    const n = countSentences(s);
    return n >= 3 && n <= 5;
  },
  { message: 'Podsumowanie musi mieć od 3 do 5 zdań' },
);

export const keyPointsSchema = z.array(nonEmpty).min(3).max(7);

export const amountSchema = z.object({
  value: z.number(),
  currency: z.string().refine(isIsoCurrency, { message: 'Waluta musi być kodem ISO 4217' }),
  context: nonEmpty,
});

export const dateEntrySchema = z.object({
  date: isoDateSchema,
  context: nonEmpty,
});

export const entitiesSchema = z.object({
  organizations: z.array(nonEmpty),
  people: z.array(nonEmpty),
});

/** Pole dodatkowe (brief pozwala dodawać pola): metadane analizy. */
export const analysisMetaSchema = z.object({
  model: nonEmpty,
  createdAt: z.string(),
  chunks: z.number().int().min(1),
  ocrPages: z.array(z.number().int().min(1)),
  warnings: z.array(nonEmpty),
});

export const insightSchema = z.object({
  document: documentSchema,
  summary: summarySchema,
  keyPoints: keyPointsSchema,
  entities: entitiesSchema,
  amounts: z.array(amountSchema),
  dates: z.array(dateEntrySchema),
  keywords: z.array(nonEmpty),
  analysis: analysisMetaSchema,
});

export type Insight = z.infer<typeof insightSchema>;
export type InsightDocument = z.infer<typeof documentSchema>;
export type Amount = z.infer<typeof amountSchema>;
export type DateEntry = z.infer<typeof dateEntrySchema>;
export type AnalysisMeta = z.infer<typeof analysisMetaSchema>;

/** Część wyniku generowana przez model (bez pól wyliczanych deterministycznie). */
export const modelOutputSchema = z.object({
  document: documentSchema.omit({ fileName: true, pages: true }),
  summary: summarySchema,
  keyPoints: keyPointsSchema,
  entities: entitiesSchema,
  amounts: z.array(amountSchema),
  dates: z.array(dateEntrySchema),
  keywords: z.array(nonEmpty),
  warnings: z.array(z.string()).default([]),
});
export type ModelOutput = z.infer<typeof modelOutputSchema>;

/** Wynik etapu "reduce" przy długich dokumentach. */
export const reduceOutputSchema = z.object({
  document: documentSchema.omit({ fileName: true, pages: true }),
  summary: summarySchema,
  keyPoints: keyPointsSchema,
});
export type ReduceOutput = z.infer<typeof reduceOutputSchema>;

/** Żądanie wysyłane z frontendu do backendu. */
export const MAX_TEXT_CHARS = 400_000;
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BASE64_CHARS = 1_500_000;

export const analyzeRequestSchema = z.object({
  fileName: nonEmpty.max(255),
  pageCount: z.number().int().min(1).max(2000),
  pages: z
    .array(z.object({ page: z.number().int().min(1), text: z.string() }))
    .min(1)
    .refine((p) => p.reduce((n, x) => n + x.text.length, 0) <= MAX_TEXT_CHARS, {
      message: 'Tekst dokumentu jest zbyt długi',
    }),
  images: z
    .array(
      z.object({
        page: z.number().int().min(1),
        mimeType: z.literal('image/jpeg'),
        data: z
          .string()
          .max(MAX_IMAGE_BASE64_CHARS)
          .regex(/^[A-Za-z0-9+/=]+$/),
      }),
    )
    .max(MAX_IMAGES),
});
export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

/** Czytelna lista błędów walidacji (do komunikatów i do ponownej próby modelu). */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}
