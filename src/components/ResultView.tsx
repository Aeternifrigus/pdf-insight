import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/context';
import type { Lang } from '../i18n/messages';
import type { ProgressEvent } from '../lib/documentTranslation';
import {
  buildSummaryMarkdown,
  contentLanguage,
  exportLanguage,
  translationTarget,
  type TranslatedDocument,
} from '../lib/exportMarkdown';
import {
  downloadText,
  formatDate,
  formatDateTime,
  formatMoney,
  jsonFileName,
  languageName,
  summaryFileName,
} from '../lib/format';
import type { PdfNote } from '../lib/pdf';
import { formatPageRanges } from '../lib/ranges';
import type { Insight, OutputLanguage } from '../lib/schema';
import { DocumentTranslationPanel } from './DocumentTranslationPanel';
import { JsonPreview } from './JsonPreview';

export type ResultNote = PdfNote | { kind: 'cached' };

interface Props {
  insight: Insight;
  translations: Partial<Record<OutputLanguage, Insight>>;
  notes: ResultNote[];
  onTranslate: (target: OutputLanguage, signal: AbortSignal) => Promise<Insight>;
  /** Tłumaczenie całego dokumentu; brak = pełny tekst niedostępny (wynik z historii). */
  translateDocument?: (
    target: OutputLanguage,
    onProgress: (p: ProgressEvent) => void,
    signal: AbortSignal,
  ) => Promise<TranslatedDocument>;
  errorMessage: (e: unknown) => string;
  onReset: () => void;
  /** Ponowna analiza pliku, którego wynik pochodzi z historii. */
  onReanalyze?: () => void;
}

/** Lokal formatowania liczb dla języka treści: kwoty w angielskim tekście "PLN 184,500.00". */
function contentLocale(lang: string): string {
  if (lang === 'pl') return 'pl-PL';
  if (lang === 'en') return 'en-GB';
  return lang;
}

type Issue = Insight['amounts'][number]['issue'];

/** "angielski" → "Angielski" (nazwy języków w Intl są pisane małą literą po polsku). */
const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/** Oznaczenie wyniku kontroli wartości w tekście dokumentu (bez AI). */
function CheckBadge({ foundInText, issue }: { foundInText?: boolean | null; issue?: Issue }) {
  const { t, lang } = useI18n();
  if (foundInText !== false && issue !== 'labelMismatch') return null;
  const kind = issue ?? 'notInText';
  const [label, title] =
    kind === 'fromInstruction'
      ? [t.result.fromInstruction, t.result.fromInstructionTitle]
      : kind === 'currencyMismatch'
        ? [t.result.currencyMismatch, t.result.currencyMismatchTitle]
        : kind === 'labelMismatch'
          ? [t.result.labelMismatch, t.result.labelMismatchTitle]
          : [t.result.notInText, t.result.notInTextTitle];
  return (
    <span
      className={`not-in-text${kind === 'fromInstruction' ? ' is-severe' : ''}`}
      title={title}
      lang={lang}
    >
      {label}
    </span>
  );
}

type TranslateState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string };

export function ResultView({
  insight,
  translations,
  notes,
  onTranslate,
  translateDocument,
  errorMessage,
  onReset,
  onReanalyze,
}: Props) {
  const { t, lang, locale } = useI18n();
  const target = translationTarget(insight.document.language);
  const [view, setView] = useState<'original' | 'translated'>('original');
  const [translateState, setTranslateState] = useState<TranslateState>({ kind: 'idle' });
  const controller = useRef<AbortController | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Stan widoku jest resetowany przez `key` w App (nowy wynik = nowa instancja komponentu).
  useEffect(() => {
    headingRef.current?.focus();
    return () => controller.current?.abort();
  }, [insight]);

  const translation = translations[target];
  const shown = view === 'translated' && translation ? translation : insight;
  const { document: doc, analysis } = shown;
  const cLang = contentLanguage(shown);
  const cLocale = contentLocale(cLang);
  const tr = analysis.translation;

  const showTranslated = async () => {
    setView('translated');
    if (translation) return;
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    setTranslateState({ kind: 'loading' });
    try {
      await onTranslate(target, ctrl.signal);
      if (!ctrl.signal.aborted) setTranslateState({ kind: 'idle' });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setTranslateState({ kind: 'error', message: errorMessage(e) });
    }
  };

  const noteText = (n: ResultNote): string => {
    if (n.kind === 'cached') return t.notes.cached;
    const pages = formatPageRanges(n.pages);
    if (n.kind === 'skipped') return t.notes.skipped(pages, n.pages.length, n.limit);
    if (n.kind === 'failed') return t.notes.failed(pages, n.pages.length);
    return t.notes.blank(pages, n.pages.length);
  };
  const warnings = [...analysis.warnings, ...notes.map(noteText)];
  const translatedTo = tr ? tr.to : undefined;
  const exportLang: Lang = exportLanguage(shown, lang);

  return (
    <article className="result" aria-labelledby="result-title">
      <header className="result-head">
        <p className="result-file">{doc.fileName}</p>
        <h2 id="result-title" ref={headingRef} tabIndex={-1} lang={cLang}>
          {doc.title ?? doc.fileName}
        </h2>
        <dl className="facts">
          <div>
            <dt>{t.result.type}</dt>
            <dd>{t.types[doc.type]}</dd>
          </div>
          <div>
            <dt>{t.result.date}</dt>
            <dd>{doc.date ? formatDate(doc.date, locale) : t.result.notGiven}</dd>
          </div>
          <div>
            <dt>{t.result.size}</dt>
            <dd>{t.pages(doc.pages)}</dd>
          </div>
          <div className={analysis.unreadPages.length > 0 ? 'fact-warn' : undefined}>
            <dt>{t.result.analysed}</dt>
            <dd>
              {analysis.unreadPages.length > 0
                ? t.result.partial(doc.pages - analysis.unreadPages.length, doc.pages)
                : t.result.wholeDocument}
            </dd>
          </div>
          <div>
            <dt>{t.result.language}</dt>
            <dd>{languageName(doc.language, lang)}</dd>
          </div>
        </dl>
      </header>

      <div className="view-switch-row">
        <span className="view-switch-label" id="view-switch-label">
          {t.view.label}
        </span>
        <div className="view-switch" role="group" aria-labelledby="view-switch-label">
          <button
            type="button"
            aria-pressed={view === 'original'}
            onClick={() => {
              controller.current?.abort();
              setTranslateState({ kind: 'idle' });
              setView('original');
            }}
          >
            {t.view.original(languageName(insight.document.language, lang))}
          </button>
          <button
            type="button"
            lang={target}
            aria-pressed={view === 'translated'}
            onClick={() => void showTranslated()}
          >
            {capitalize(languageName(target, lang))}
          </button>
        </div>
      </div>

      {view === 'translated' && translateState.kind === 'loading' && (
        <p className="progress-status" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          {t.view.translating}
        </p>
      )}
      {view === 'translated' && translateState.kind === 'error' && (
        <div className="inline-error" role="alert">
          <p>
            {t.view.translationFailed} {translateState.message}
          </p>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => void showTranslated()}
          >
            {t.error.retry}
          </button>
        </div>
      )}

      {tr && (
        <aside className={tr.numbersVerified ? 'translation-note' : 'translation-note is-warn'}>
          <p>{t.view.machineTranslation(languageName(tr.from, lang), tr.model)}</p>
          {tr.numbersVerified ? (
            <p>{t.view.numbersVerified}</p>
          ) : (
            <>
              <p>{t.view.numbersNotVerified}</p>
              <ul>
                {tr.issues.map((i, n) => (
                  <li key={`${String(n)}-${i.field}`}>{t.view.issue(i)}</li>
                ))}
              </ul>
            </>
          )}
        </aside>
      )}

      {warnings.length > 0 && (
        <aside className="warnings" aria-label={t.result.warnings}>
          <h3>{t.result.warnings}</h3>
          <ul>
            {warnings.map((w, i) => (
              <li key={`${String(i)}-${w}`}>{w}</li>
            ))}
          </ul>
        </aside>
      )}

      <section className="block" aria-labelledby="summary-title">
        <h3 id="summary-title">{t.result.summary}</h3>
        <p className="summary" lang={cLang}>
          {shown.summary}
        </p>
      </section>

      <section className="block" aria-labelledby="points-title">
        <h3 id="points-title">{t.result.keyPoints}</h3>
        <ul className="points" lang={cLang}>
          {shown.keyPoints.map((p, i) => (
            <li key={`${String(i)}-${p}`}>{p}</li>
          ))}
        </ul>
      </section>

      <div className="grid">
        <section className="block" aria-labelledby="amounts-title">
          <h3 id="amounts-title">{t.result.amounts(shown.amounts.length)}</h3>
          {shown.amounts.length === 0 ? (
            <p className="muted">{t.result.noAmounts}</p>
          ) : (
            <div
              className="table-wrap"
              tabIndex={0}
              role="region"
              aria-label={t.result.amountsTable}
            >
              <table className="amounts">
                <thead>
                  <tr>
                    <th scope="col">{t.result.amount}</th>
                    <th scope="col">{t.result.concerns}</th>
                  </tr>
                </thead>
                <tbody lang={cLang}>
                  {shown.amounts.map((a, i) => (
                    <tr key={`${String(i)}-${a.currency}-${String(a.value)}`}>
                      <td className="amount">
                        <mark>{formatMoney(a.value, a.currency, cLocale)}</mark>
                      </td>
                      <td>
                        {a.context}
                        <CheckBadge foundInText={a.foundInText} issue={a.issue} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="block" aria-labelledby="dates-title">
          <h3 id="dates-title">{t.result.dates(shown.dates.length)}</h3>
          {shown.dates.length === 0 ? (
            <p className="muted">{t.result.noDates}</p>
          ) : (
            <ol className="timeline" lang={cLang}>
              {shown.dates.map((d, i) => (
                <li key={`${String(i)}-${d.date}`}>
                  <time dateTime={d.date}>{formatDate(d.date, cLocale)}</time>
                  <span>
                    {d.context}
                    <CheckBadge foundInText={d.foundInText} issue={d.issue} />
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <div className="grid">
        <section className="block" aria-labelledby="orgs-title">
          <h3 id="orgs-title">{t.result.organisations}</h3>
          {shown.entities.organizations.length === 0 ? (
            <p className="muted">{t.result.noOrganisations}</p>
          ) : (
            <ul className="plain">
              {shown.entities.organizations.map((o, i) => (
                <li key={`${String(i)}-${o}`}>{o}</li>
              ))}
            </ul>
          )}
          <h3 id="people-title" className="subhead">
            {t.result.people}
          </h3>
          {shown.entities.people.length === 0 ? (
            <p className="muted">{t.result.noPeople}</p>
          ) : (
            <ul className="plain">
              {shown.entities.people.map((p, i) => (
                <li key={`${String(i)}-${p}`}>{p}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="block" aria-labelledby="keywords-title">
          <h3 id="keywords-title">{t.result.keywords}</h3>
          {shown.keywords.length === 0 ? (
            <p className="muted">{t.result.noKeywords}</p>
          ) : (
            <ul className="tags" lang={cLang}>
              {shown.keywords.map((k, i) => (
                <li key={`${String(i)}-${k}`}>{k}</li>
              ))}
            </ul>
          )}
          <p className="meta">
            {t.result.meta(
              analysis.model,
              formatDateTime(analysis.createdAt, locale),
              analysis.chunks,
              analysis.ocrPages.length > 0 ? formatPageRanges(analysis.ocrPages) : '',
            )}
          </p>
        </section>
      </div>

      <section className="downloads" aria-labelledby="downloads-title">
        <h3 id="downloads-title">{t.downloads.title}</h3>
        <div className="actions">
          <button
            type="button"
            className="button button-ghost"
            onClick={() => {
              downloadText(
                buildSummaryMarkdown(shown, exportLang),
                summaryFileName(doc.fileName, translatedTo),
                'text/markdown',
              );
            }}
          >
            {t.downloads.summary(cLang.toUpperCase())}
          </button>
        </div>
      </section>

      <JsonPreview insight={shown} fileName={jsonFileName(doc.fileName, translatedTo)} />

      <DocumentTranslationPanel
        fileName={insight.document.fileName}
        title={(translation ?? insight).document.title}
        target={target}
        run={
          translateDocument
            ? (onProgress, signal) => translateDocument(target, onProgress, signal)
            : undefined
        }
        errorMessage={errorMessage}
      />

      <div className="actions result-actions">
        {onReanalyze && (
          <button type="button" className="button button-primary" onClick={onReanalyze}>
            {t.result.reanalyze}
          </button>
        )}
        <button type="button" className="button button-ghost" onClick={onReset}>
          {t.result.next}
        </button>
      </div>
    </article>
  );
}
