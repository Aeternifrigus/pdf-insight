import type { Insight } from './schema';

export const TYPE_LABELS: Record<Insight['document']['type'], string> = {
  faktura: 'Faktura',
  umowa: 'Umowa',
  oferta: 'Oferta',
  raport: 'Raport',
  inne: 'Inny dokument',
};

export function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('pl-PL', { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toLocaleString('pl-PL')} ${currency}`;
  }
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

export function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames(['pl'], { type: 'language' }).of(code);
    return name ?? code;
  } catch {
    return code;
  }
}

export function pagesLabel(n: number): string {
  if (n === 1) return '1 strona';
  const last = n % 10;
  const lastTwo = n % 100;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${n} strony`;
  return `${n} stron`;
}

export function jsonFileName(fileName: string): string {
  const base = fileName.replace(/\.pdf$/i, '').replace(/[^\p{L}\p{N}._-]+/gu, '_') || 'dokument';
  return `${base}.insight.json`;
}

export function downloadJson(insight: Insight): void {
  const blob = new Blob([JSON.stringify(insight, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = jsonFileName(insight.document.fileName);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
