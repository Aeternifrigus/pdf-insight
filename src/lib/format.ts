/**
 * Formatowanie zależne od języka. Ten sam wynik w polskim widoku: "184 500,00 zł", "12 marca 2026";
 * w angielskim: "PLN 184,500.00", "12 March 2026". `locale` to np. "pl-PL" albo "en-GB".
 */
export function formatMoney(value: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  } catch {
    return `${formatNumber(value, locale)} ${currency}`;
  }
}

export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

export function formatDate(iso: string, locale: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

/** Nazwa języka w języku interfejsu ("polski" / "Polish"). */
export function languageName(code: string, uiLang: string): string {
  try {
    return new Intl.DisplayNames([uiLang], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function fileBase(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '').replace(/[^\p{L}\p{N}._-]+/gu, '_') || 'dokument';
}

/** Nazwy plików: oryginał bez sufiksu języka, tłumaczenie z sufiksem (np. umowa.insight.en.json). */
export function jsonFileName(fileName: string, translatedTo?: string): string {
  return `${fileBase(fileName)}.insight${translatedTo ? `.${translatedTo}` : ''}.json`;
}

export function summaryFileName(fileName: string, translatedTo?: string): string {
  return `${fileBase(fileName)}.summary${translatedTo ? `.${translatedTo}` : ''}.md`;
}

export function documentTranslationFileName(fileName: string, lang: string): string {
  return `${fileBase(fileName)}.${lang}.md`;
}

export function downloadText(content: string, fileName: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  // Safari na iOS potrafi zacząć pobieranie z opóźnieniem; zbyt wczesne zwolnienie adresu je przerywa.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}
