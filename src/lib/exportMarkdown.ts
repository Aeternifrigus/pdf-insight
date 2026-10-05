import { LOCALES, MESSAGES, type Lang } from '../i18n/messages';
import { formatDate, formatDateTime, formatMoney, languageName } from './format';
import { formatPageRanges } from './ranges';
import type { Insight, NumericIssue } from './schema';

/**
 * Tekst z dokumentu wstawiany do Markdown jest escapowany: PDF nie może dzięki temu wstawić
 * do eksportu linku, obrazka (ładowanego z cudzego serwera przy podglądzie) ani HTML.
 */
export function escapeMd(text: string): string {
  return (
    text
      .replace(/([\\`*_{}[\]<>()#+!|~])/g, '\\$1')
      // Początek wiersza wyglądający jak lista: "1. " i "- ".
      .replace(/^(\s*)(\d+)\.(\s)/gm, '$1$2\\.$3')
      .replace(/^(\s*)-(\s)/gm, '$1\\-$2')
  );
}

/** Wiele linii z zachowaniem podziału (twarde złamania wiersza w Markdown). */
function escapeLines(text: string): string {
  return text
    .split('\n')
    .map((line) => escapeMd(line))
    .join('  \n');
}

function issueLabel(
  t: (typeof MESSAGES)[Lang],
  issue: 'notInText' | 'currencyMismatch' | 'fromInstruction' | undefined,
): string {
  if (issue === 'fromInstruction') return t.result.fromInstruction;
  if (issue === 'currencyMismatch') return t.result.currencyMismatch;
  return t.result.notInText;
}

/** Język tekstów w wyniku: tłumaczenie albo język dokumentu. */
export function contentLanguage(insight: Insight): string {
  return insight.analysis.translation?.to ?? insight.document.language;
}

/** Język docelowy tłumaczenia: angielski, a dla dokumentów angielskich polski. */
export function translationTarget(documentLanguage: string): Lang {
  return documentLanguage === 'en' ? 'pl' : 'en';
}

/** Język nagłówków eksportu: język treści, jeśli to PL lub EN, inaczej język interfejsu. */
export function exportLanguage(insight: Insight, uiLang: Lang): Lang {
  const c = contentLanguage(insight);
  return c === 'pl' || c === 'en' ? c : uiLang;
}

export function buildSummaryMarkdown(insight: Insight, lang: Lang): string {
  const t = MESSAGES[lang];
  const locale = LOCALES[lang];
  const doc = insight.document;
  const title = doc.title ?? doc.fileName;
  const out: string[] = [];

  out.push(`# ${escapeMd(t.exportText.summaryTitle(title))}`, '');
  out.push(`- ${t.exportText.source}: ${escapeMd(doc.fileName)}`);
  out.push(`- ${t.exportText.type}: ${t.types[doc.type]}`);
  out.push(
    `- ${t.exportText.date}: ${doc.date ? formatDate(doc.date, locale) : t.result.notGiven}`,
  );
  out.push(`- ${t.exportText.language}: ${languageName(doc.language, lang)}`);
  out.push(`- ${t.exportText.pages}: ${String(doc.pages)}`, '');

  const tr = insight.analysis.translation;
  if (tr) {
    out.push(
      `> ${t.exportText.machineTranslation(languageName(tr.from, lang), tr.model, formatDateTime(tr.createdAt, locale))}`,
      '',
    );
  }

  out.push(`## ${t.result.summary}`, '', escapeMd(insight.summary), '');
  out.push(`## ${t.result.keyPoints}`, '', ...insight.keyPoints.map((p) => `- ${escapeMd(p)}`), '');

  out.push(`## ${t.result.amounts(insight.amounts.length)}`, '');
  if (insight.amounts.length === 0) out.push(t.result.noAmounts, '');
  else {
    out.push(`| ${t.result.amount} | ${t.result.concerns} |`, '| ---: | --- |');
    for (const a of insight.amounts) {
      const flag = a.foundInText === false ? ` (${issueLabel(t, a.issue)})` : '';
      out.push(`| ${formatMoney(a.value, a.currency, locale)} | ${escapeMd(a.context)}${flag} |`);
    }
    out.push('');
  }

  out.push(`## ${t.result.dates(insight.dates.length)}`, '');
  if (insight.dates.length === 0) out.push(t.result.noDates, '');
  else {
    for (const d of insight.dates) {
      const flag = d.foundInText === false ? ` (${issueLabel(t, d.issue)})` : '';
      out.push(`- ${formatDate(d.date, locale)}: ${escapeMd(d.context)}${flag}`);
    }
    out.push('');
  }

  const list = (heading: string, items: string[], empty: string) => {
    out.push(
      `## ${heading}`,
      '',
      ...(items.length ? items.map((i) => `- ${escapeMd(i)}`) : [empty]),
      '',
    );
  };
  list(t.result.organisations, insight.entities.organizations, t.result.noOrganisations);
  list(t.result.people, insight.entities.people, t.result.noPeople);
  list(t.result.keywords, insight.keywords, t.result.noKeywords);

  const warnings = [
    ...insight.analysis.warnings,
    ...(tr && !tr.numbersVerified ? tr.issues.map((i) => t.view.issue(i)) : []),
  ];
  if (warnings.length > 0) list(t.result.warnings, warnings, '');

  return `${out.join('\n').trimEnd()}\n`;
}

export interface TranslatedDocument {
  from: string;
  to: Lang;
  model: string;
  createdAt: string;
  pages: { page: number; text: string }[];
  issues: NumericIssue[];
  scannedPages: number[];
}

export function buildTranslatedDocumentMarkdown(
  doc: TranslatedDocument,
  source: { fileName: string; title: string | null },
): string {
  const t = MESSAGES[doc.to];
  const locale = LOCALES[doc.to];
  const out: string[] = [];
  out.push(`# ${escapeMd(t.exportText.documentTitle(source.title ?? source.fileName))}`, '');
  out.push(`- ${t.exportText.source}: ${escapeMd(source.fileName)}`, '');
  out.push(
    `> ${t.exportText.machineTranslation(languageName(doc.from, doc.to), doc.model, formatDateTime(doc.createdAt, locale))}`,
    '',
  );
  for (const p of doc.pages) {
    out.push(`## ${t.exportText.page(p.page)}`, '', escapeLines(p.text.trim()), '');
  }
  out.push(`## ${t.exportText.check}`, '');
  if (doc.issues.length === 0) out.push(t.documentTranslation.allVerified);
  else out.push(...doc.issues.map((i) => `- ${escapeMd(t.exportText.issue(i))}`));
  if (doc.scannedPages.length > 0) {
    out.push('', t.exportText.scannedNotChecked(formatPageRanges(doc.scannedPages)));
  }
  return `${out.join('\n').trimEnd()}\n`;
}
