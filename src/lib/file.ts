export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Błąd odczytu PDF z komunikatem gotowym do pokazania użytkownikowi. */
export class PdfReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfReadError';
  }
}

export type FileCheck = { ok: true } | { ok: false; message: string };

/** Walidacja przed odczytem: rozmiar, rozszerzenie/typ i sygnatura %PDF-. */
export async function checkPdfFile(file: File): Promise<FileCheck> {
  const looksLikePdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!looksLikePdf) {
    return { ok: false, message: 'To nie jest plik PDF. Wybierz plik z rozszerzeniem .pdf.' };
  }
  if (file.size === 0) {
    return { ok: false, message: 'Plik jest pusty.' };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      message: `Plik ma ${formatBytes(file.size)}. Maksymalny rozmiar to 10 MB.`,
    };
  }
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  if (!hasPdfSignature(head)) {
    return { ok: false, message: 'Plik ma rozszerzenie .pdf, ale jego zawartość nie jest PDF-em.' };
  }
  return { ok: true };
}

export function hasPdfSignature(bytes: Uint8Array): boolean {
  const text = new TextDecoder('latin1').decode(bytes);
  return text.includes('%PDF-');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
