import { ApiError } from '../api/analyze';
import { PdfReadError } from '../lib/file';
import { MAX_TEXT_CHARS } from '../lib/schema';
import { errorText, type Messages } from './messages';

/** Błąd wstępnej kontroli pliku (przed odczytem pdf.js). */
export class FileCheckError extends Error {
  constructor(
    public readonly code: 'NOT_PDF' | 'EMPTY' | 'BAD_SIGNATURE' | 'TOO_LARGE',
    public readonly size = 0,
  ) {
    super(code);
    this.name = 'FileCheckError';
  }
}

/** Komunikat błędu w języku interfejsu (kod z API lub z odczytu PDF). */
export function describeError(t: Messages, locale: string, e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'BAD_RESPONSE') return t.errors.BAD_RESPONSE(e.status ?? 0);
    return errorText(t, e.code, e.message);
  }
  if (e instanceof PdfReadError) {
    const p = e.params;
    if (e.code === 'TOO_MANY_PAGES') return t.errors.TOO_MANY_PAGES(p.pages ?? 0);
    if (e.code === 'TOO_MUCH_TEXT') {
      return t.errors.TOO_MUCH_TEXT(
        new Intl.NumberFormat(locale).format(MAX_TEXT_CHARS),
        p.page ?? 0,
        p.total ?? 0,
      );
    }
    return t.errors[e.code];
  }
  return t.errors.UNEXPECTED;
}
