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
  /**
   * Pole dodatkowe: czy wartość występuje w tekście dokumentu (sprawdzane deterministycznie).
   * null, gdy nie da się tego sprawdzić (część treści pochodzi ze skanów).
   */
  foundInText: z.boolean().nullable().optional(),
  /**
   * Pole dodatkowe: powód, dla którego `foundInText` jest false. `currencyMismatch`: wartość jest
   * w dokumencie tylko z inną walutą; `fromInstruction`: wartość występuje wyłącznie
   * w podejrzanym poleceniu dla AI (możliwa manipulacja wynikiem).
   */
  issue: z.enum(['notInText', 'currencyMismatch', 'fromInstruction']).optional(),
});

export const dateEntrySchema = z.object({
  date: isoDateSchema,
  context: nonEmpty,
  foundInText: z.boolean().nullable().optional(),
  issue: z.enum(['notInText', 'fromInstruction']).optional(),
});

export const entitiesSchema = z.object({
  organizations: z.array(nonEmpty),
  people: z.array(nonEmpty),
});

/** Pole dodatkowe (brief pozwala dodawać pola): metadane analizy. */
/** Języki, na które można przetłumaczyć wynik (i języki interfejsu). */
export const OUTPUT_LANGUAGES = ['pl', 'en'] as const;
export type OutputLanguage = (typeof OUTPUT_LANGUAGES)[number];

const languageCode = z.string().regex(/^[a-z]{2}$/, { message: 'Kod ISO 639-1' });

/** Problem z liczbami w jednym przetłumaczonym polu (lub na jednej stronie dokumentu). */
export const numericIssueSchema = z.object({
  field: nonEmpty,
  missing: z.array(z.string()),
  extra: z.array(z.string()),
  wrongFormat: z.array(z.string()),
});
export type NumericIssue = z.infer<typeof numericIssueSchema>;

/**
 * Pole dodatkowe w tłumaczeniu wyniku. `document.language` nadal opisuje język dokumentu,
 * a teksty (podsumowanie, punkty, opisy kwot i dat) są w języku `to`.
 */
export const translationMetaSchema = z.object({
  from: languageCode,
  to: z.enum(OUTPUT_LANGUAGES),
  model: nonEmpty,
  createdAt: z.string(),
  /** Czy liczby i daty w przetłumaczonych tekstach zgadzają się z oryginałem. */
  numbersVerified: z.boolean(),
  issues: z.array(numericIssueSchema),
});
export type TranslationMeta = z.infer<typeof translationMetaSchema>;

export const analysisMetaSchema = z.object({
  model: nonEmpty,
  createdAt: z.string(),
  chunks: z.number().int().min(1),
  ocrPages: z.array(z.number().int().min(1)),
  /** Strony, których treść nie trafiła do analizy (skany ponad limit, błędy odczytu). */
  unreadPages: z.array(z.number().int().min(1)).default([]),
  warnings: z.array(nonEmpty),
  translation: translationMetaSchema.optional(),
  /**
   * Wynik od zapasowego dostawcy (Groq, Workers AI), gdy Gemini nie odpowiadało. Taki wynik
   * bywa mniej kompletny, więc nie jest używany ponownie z historii dla tego samego pliku.
   */
  backup: z.boolean().optional(),
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

/**
 * Wynik jednej części długiego dokumentu (etap "map"). Reguły 3–5 zdań i 3–7 punktów
 * dotyczą wyniku końcowego; część złożona np. z samej tabeli cen może ich nie spełnić,
 * a wcześniej taki fragment wywracał analizę całego dokumentu.
 */
export const partialOutputSchema = modelOutputSchema.extend({
  summary: nonEmpty,
  keyPoints: z.array(nonEmpty).max(7),
});

/** Wynik etapu "reduce" przy długich dokumentach. */
export const reduceOutputSchema = z.object({
  document: documentSchema.omit({ fileName: true, pages: true }),
  summary: summarySchema,
  keyPoints: keyPointsSchema,
});
export type ReduceOutput = z.infer<typeof reduceOutputSchema>;

/** Żądanie wysyłane z frontendu do backendu. */
/**
 * Limity dobrane pod budżet CPU Cloudflare Workers (plan darmowy: 10 ms na żądanie).
 * Parsowanie i walidacja najgorszego przypadku mieszczą się w kilku ms.
 * Treść obrazów nie jest sprawdzana regexem (koszt O(n)); robi to dostawca AI.
 */
export const MAX_TEXT_CHARS = 400_000;
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BASE64_CHARS = 600_000;

export const analyzeRequestSchema = z
  .object({
    fileName: nonEmpty.max(255),
    pageCount: z.number().int().min(1).max(2000),
    pages: z
      .array(z.object({ page: z.number().int().min(1), text: z.string() }))
      .min(1)
      .refine((p) => p.reduce((n, x) => n + x.text.length, 0) <= MAX_TEXT_CHARS, {
        message: 'Tekst dokumentu jest zbyt długi',
      }),
    unreadPages: z.array(z.number().int().min(1)).max(2000).default([]),
    images: z
      .array(
        z.object({
          page: z.number().int().min(1),
          mimeType: z.literal('image/jpeg'),
          data: z.string().min(1).max(MAX_IMAGE_BASE64_CHARS),
        }),
      )
      .max(MAX_IMAGES),
  })
  .superRefine((req, ctx) => {
    const pageNumbers = new Set<number>();
    for (const { page } of req.pages) {
      if (page > req.pageCount) {
        ctx.addIssue({ code: 'custom', path: ['pages'], message: `Strona ${page} poza zakresem` });
      }
      if (pageNumbers.has(page)) {
        ctx.addIssue({ code: 'custom', path: ['pages'], message: `Powtórzona strona ${page}` });
      }
      pageNumbers.add(page);
    }
    if (req.unreadPages.some((p) => p > req.pageCount)) {
      ctx.addIssue({ code: 'custom', path: ['unreadPages'], message: 'Strona poza zakresem' });
    }
    const imagePages = new Set<number>();
    for (const { page } of req.images) {
      if (!pageNumbers.has(page) || imagePages.has(page)) {
        ctx.addIssue({
          code: 'custom',
          path: ['images'],
          message: `Obraz dla strony ${page} nie pasuje do listy stron`,
        });
      }
      imagePages.add(page);
    }
  });
export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

/** Teksty wyniku, które są tłumaczone. Liczby, waluty i daty nigdy nie trafiają do tłumaczenia. */
export const translatableTextsSchema = z.object({
  title: z.string().trim().min(1).nullable(),
  summary: summarySchema,
  keyPoints: z.array(nonEmpty),
  amountContexts: z.array(nonEmpty),
  dateContexts: z.array(nonEmpty),
  keywords: z.array(nonEmpty),
  warnings: z.array(nonEmpty),
});
export type TranslatableTexts = z.infer<typeof translatableTextsSchema>;

export const translateRequestSchema = z.object({
  target: z.enum(OUTPUT_LANGUAGES),
  insight: insightSchema.refine((i) => !i.analysis.translation, {
    message: 'Wynik jest już tłumaczeniem',
  }),
});
export type TranslateRequest = z.infer<typeof translateRequestSchema>;

/** Tłumaczenie całego dokumentu odbywa się fragmentami (każdy fragment to osobne żądanie). */
export const MAX_TRANSLATE_CHUNK_CHARS = 12_000;
export const MAX_TRANSLATE_CHUNK_IMAGES = 2;
/** Górny limit tekstu całego dokumentu do tłumaczenia (ok. 50 stron, kilkanaście żądań). */
export const MAX_TRANSLATE_DOCUMENT_CHARS = 120_000;

export const translateDocumentRequestSchema = z
  .object({
    target: z.enum(OUTPUT_LANGUAGES),
    sourceLanguage: languageCode,
    pages: z
      .array(
        z.object({
          page: z.number().int().min(1),
          text: z.string().max(MAX_TRANSLATE_CHUNK_CHARS),
        }),
      )
      .min(1)
      .max(60)
      .refine((p) => p.reduce((n, x) => n + x.text.length, 0) <= MAX_TRANSLATE_CHUNK_CHARS, {
        message: 'Fragment jest zbyt długi',
      }),
    images: z
      .array(
        z.object({
          page: z.number().int().min(1),
          mimeType: z.literal('image/jpeg'),
          data: z.string().min(1).max(MAX_IMAGE_BASE64_CHARS),
        }),
      )
      .max(MAX_TRANSLATE_CHUNK_IMAGES),
  })
  .superRefine((req, ctx) => {
    const pages = req.pages.map((p) => p.page);
    if (new Set(pages).size !== pages.length) {
      ctx.addIssue({ code: 'custom', path: ['pages'], message: 'Powtórzone strony' });
    }
    if (req.images.some((i) => !pages.includes(i.page))) {
      ctx.addIssue({ code: 'custom', path: ['images'], message: 'Obraz spoza fragmentu' });
    }
  });
export type TranslateDocumentRequest = z.infer<typeof translateDocumentRequestSchema>;

export const translatedPagesSchema = z.object({
  pages: z.array(z.object({ page: z.number().int().min(1), text: z.string() })),
});

export const translateDocumentResponseSchema = z.object({
  pages: z.array(z.object({ page: z.number().int().min(1), text: z.string() })),
  issues: z.array(numericIssueSchema),
  model: nonEmpty,
});
export type TranslateDocumentResponse = z.infer<typeof translateDocumentResponseSchema>;

/** Czytelna lista błędów walidacji (do komunikatów i do ponownej próby modelu). */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}
