export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Błąd odczytu PDF jako kod + parametry; tekst komunikatu powstaje w interfejsie
 * w wybranym języku (PL/EN).
 */
export type PdfErrorCode = 'PASSWORD' | 'CORRUPT' | 'TOO_MANY_PAGES' | 'TOO_MUCH_TEXT';

export class PdfReadError extends Error {
  constructor(
    public readonly code: PdfErrorCode,
    public readonly params: { pages?: number; page?: number; total?: number } = {},
  ) {
    super(code);
    this.name = 'PdfReadError';
  }
}

export type FileCheck =
  | { ok: true }
  | { ok: false; code: 'NOT_PDF' | 'EMPTY' | 'BAD_SIGNATURE' }
  | { ok: false; code: 'TOO_LARGE'; size: number };

/** Walidacja przed odczytem: rozmiar, rozszerzenie/typ i sygnatura %PDF-. */
export async function checkPdfFile(file: File): Promise<FileCheck> {
  const looksLikePdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!looksLikePdf) {
    return { ok: false, code: 'NOT_PDF' };
  }
  if (file.size === 0) {
    return { ok: false, code: 'EMPTY' };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, code: 'TOO_LARGE', size: file.size };
  }
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  if (!hasPdfSignature(head)) {
    return { ok: false, code: 'BAD_SIGNATURE' };
  }
  return { ok: true };
}

export function hasPdfSignature(bytes: Uint8Array): boolean {
  const text = new TextDecoder('latin1').decode(bytes);
  return text.includes('%PDF-');
}

/** Rozmiar pliku w zapisie danego języka: "11,0 MB" po polsku, "11.0 MB" po angielsku. */
export function formatBytes(bytes: number, locale = 'pl-PL'): string {
  const fmt = (n: number, digits: number) =>
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${fmt(bytes / 1024, 0)} KB`;
  return `${fmt(bytes / (1024 * 1024), 1)} MB`;
}
