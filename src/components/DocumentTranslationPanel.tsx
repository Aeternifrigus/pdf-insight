import { useRef, useState } from 'react';
import { useI18n } from '../i18n/context';
import type { Lang } from '../i18n/messages';
import { DocumentTooLongError, type ProgressEvent } from '../lib/documentTranslation';
import { buildTranslatedDocumentMarkdown, type TranslatedDocument } from '../lib/exportMarkdown';
import {
  documentTranslationFileName,
  downloadText,
  formatNumber,
  languageName,
} from '../lib/format';
import { MAX_TRANSLATE_DOCUMENT_CHARS } from '../lib/schema';

interface Props {
  fileName: string;
  title: string | null;
  target: Lang;
  /** Brak funkcji = pełny tekst dokumentu nie jest dostępny (wynik z historii). */
  run?: (
    onProgress: (p: ProgressEvent) => void,
    signal: AbortSignal,
  ) => Promise<TranslatedDocument>;
  errorMessage: (e: unknown) => string;
}

type State =
  | { kind: 'idle' }
  | { kind: 'running'; progress: ProgressEvent }
  | { kind: 'done'; doc: TranslatedDocument }
  | { kind: 'error'; message: string };

export function DocumentTranslationPanel({ fileName, title, target, run, errorMessage }: Props) {
  const { t, lang, locale } = useI18n();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const controller = useRef<AbortController | null>(null);
  const targetName = languageName(target, lang);
  const outName = documentTranslationFileName(fileName, target);

  const start = async () => {
    if (!run) return;
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    setState({ kind: 'running', progress: { done: 0, total: 0 } });
    try {
      const doc = await run((progress) => {
        if (!ctrl.signal.aborted) setState({ kind: 'running', progress });
      }, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setState({ kind: 'done', doc });
      downloadText(
        buildTranslatedDocumentMarkdown(doc, { fileName, title }),
        outName,
        'text/markdown',
      );
    } catch (e) {
      if (ctrl.signal.aborted) return;
      const message =
        e instanceof DocumentTooLongError
          ? t.documentTranslation.tooLong(formatNumber(MAX_TRANSLATE_DOCUMENT_CHARS, locale))
          : errorMessage(e);
      setState({ kind: 'error', message });
    }
  };

  return (
    <section className="block doc-translation" aria-labelledby="doc-translation-title">
      <h3 id="doc-translation-title">{t.documentTranslation.title}</h3>
      {!run ? (
        <p className="muted">{t.documentTranslation.needsFile}</p>
      ) : (
        <>
          <p className="muted">{t.documentTranslation.intro(targetName)}</p>
          {state.kind === 'running' ? (
            <div className="actions">
              <p className="progress-status" role="status" aria-live="polite">
                <span className="spinner" aria-hidden="true" />
                {state.progress.waitingSeconds
                  ? t.documentTranslation.waiting(state.progress.waitingSeconds)
                  : t.documentTranslation.progress(
                      Math.min(state.progress.done + 1, Math.max(state.progress.total, 1)),
                      Math.max(state.progress.total, 1),
                    )}
              </p>
              <button
                type="button"
                className="button button-ghost"
                onClick={() => {
                  controller.current?.abort();
                  setState({ kind: 'idle' });
                }}
              >
                {t.documentTranslation.cancel}
              </button>
            </div>
          ) : (
            <div className="actions">
              <button type="button" className="button button-ghost" onClick={() => void start()}>
                {t.documentTranslation.start(targetName)}
              </button>
              {state.kind === 'done' && (
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => {
                    downloadText(
                      buildTranslatedDocumentMarkdown(state.doc, { fileName, title }),
                      outName,
                      'text/markdown',
                    );
                  }}
                >
                  {t.documentTranslation.download(outName)}
                </button>
              )}
            </div>
          )}
          {state.kind === 'done' && (
            <p role="status" className={state.doc.issues.length ? 'inline-warn' : 'muted'}>
              {t.documentTranslation.done}{' '}
              {state.doc.issues.length === 0
                ? t.documentTranslation.allVerified
                : t.documentTranslation.someIssues(
                    new Set(state.doc.issues.map((i) => i.field)).size,
                  )}
            </p>
          )}
          {state.kind === 'error' && (
            <p role="alert" className="inline-error">
              {t.documentTranslation.failed} {state.message}
            </p>
          )}
        </>
      )}
    </section>
  );
}
