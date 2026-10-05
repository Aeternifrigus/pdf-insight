/**
 * Wartości wypełnionych pól formularza (AcroForm). pdf.js nie zwraca ich w warstwie tekstowej
 * strony (są w adnotacjach typu Widget), więc bez tego kwoty i daty wpisane w formularz
 * znikały bez śladu. Funkcja jest czysta: przyjmuje dane adnotacji z page.getAnnotations().
 */

/** Flaga pola hasła w specyfikacji PDF (bit 14). */
const PASSWORD_FLAG = 1 << 13;

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function formFieldLines(annotations: unknown[]): string[] {
  const lines: string[] = [];
  for (const raw of annotations) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    if (a.subtype !== 'Widget') continue;
    if (typeof a.fieldFlags === 'number' && (a.fieldFlags & PASSWORD_FLAG) !== 0) continue;

    const label = str(a.alternativeText) || str(a.fieldName) || 'pole';
    let value = '';
    if (a.checkBox === true || a.radioButton === true) {
      const v = str(a.fieldValue);
      if (v && v !== 'Off') value = a.radioButton === true ? v : 'zaznaczone';
    } else if (Array.isArray(a.fieldValue)) {
      value = a.fieldValue.map(str).filter(Boolean).join(', ');
    } else {
      value = str(a.fieldValue);
    }
    if (value) lines.push(`${label}: ${value}`);
  }
  return [...new Set(lines)];
}
