import { useCallback, useEffect, useRef, useState } from 'react';
import {
  analyze,
  ApiError,
  buildRequest,
  isApiConfigured,
  translate,
  translateDocumentChunk,
} from './api/analyze';
import { ErrorPanel } from './components/ErrorPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { LanguageSwitch } from './components/LanguageSwitch';
import { ProgressPanel } from './components/ProgressPanel';
import { ResultView, type ResultNote } from './components/ResultView';
import { UploadZone } from './components/UploadZone';
import { useI18n } from './i18n/context';
import { describeError, FileCheckError } from './i18n/errors';
import { translateWholeDocument, type ProgressEvent } from './lib/documentTranslation';
import type { TranslatedDocument } from './lib/exportMarkdown';
import { checkPdfFile, formatBytes, PdfReadError } from './lib/file';
import {
  addToHistory,
  clearHistory,
  findByHash,
  hashFile,
  HISTORY_KEY,
  loadHistory,
  removeFromHistory,
  saveTranslation,
  type HistoryEntry,
} from './lib/history';
import type { ExtractedPdf } from './lib/pdf';
import { verifyInsight } from './lib/verify';
import type { Insight, OutputLanguage } from './lib/schema';

const AUTHOR_URL = 'https://aeternifrigus.netlify.app/';

/** Błąd jako dane: tekst powstaje przy wyświetlaniu, w bieżącym języku interfejsu. */
type ErrorInfo = { error: unknown } | { code: 'NO_TEXT' };

type Phase =
  | { kind: 'empty' }
  | { kind: 'reading'; fileName: string; done: number; total: number; startedAt: number }
  | { kind: 'analyzing'; fileName: string; startedAt: number }
  | { kind: 'error'; info: ErrorInfo; retryFile: File | null }
  | {
      kind: 'result';
      insight: Insight;
      translations: Partial<Record<OutputLanguage, Insight>>;
      notes: ResultNote[];
      historyId: string | null;
      /** Plik źródłowy (gdy wynik nie pochodzi tylko z historii): ponowna analiza i tłumaczenie całości. */
      file?: File;
      extracted?: ExtractedPdf;
      fromCache?: boolean;
    };

export default function App() {
  const { t, locale } = useI18n();
  const [phase, setPhase] = useState<Phase>({ kind: 'empty' });
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const controller = useRef<AbortController | null>(null);

  // Historia zmieniona w innej karcie: odświeżamy listę, żeby nie nadpisać jej starszą wersją.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === HISTORY_KEY || e.key === null) setHistory(loadHistory());
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Plik upuszczony poza strefą wgrywania nie może otworzyć się zamiast aplikacji.
  useEffect(() => {
    const block = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
    };
  }, []);

  const errorMessage = useCallback(
    (e: unknown): string => {
      if (e instanceof FileCheckError) {
        return e.code === 'TOO_LARGE'
          ? t.errors.TOO_LARGE(formatBytes(e.size, locale))
          : t.errors[e.code];
      }
      return describeError(t, locale, e);
    },
    [t, locale],
  );

  const run = useCallback(async (file: File, force = false) => {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    const cancelled = () => ctrl.signal.aborted;
    const startedAt = Date.now();

    const check = await checkPdfFile(file);
    // W międzyczasie użytkownik mógł wybrać inny plik.
    if (cancelled()) return;
    if (!check.ok) {
      const error = new FileCheckError(check.code, check.code === 'TOO_LARGE' ? check.size : 0);
      setPhase({ kind: 'error', info: { error }, retryFile: null });
      return;
    }

    // Ten sam plik był już analizowany: pokazujemy zapisany wynik zamiast zużywać limit API.
    const fileHash = await hashFile(file);
    if (cancelled()) return;
    const cached = fileHash && !force ? findByHash(fileHash) : undefined;
    if (cached) {
      setPhase({
        kind: 'result',
        insight: cached.insight,
        translations: cached.translations ?? {},
        notes: [{ kind: 'cached' }],
        historyId: cached.id,
        file,
        fromCache: true,
      });
      return;
    }

    try {
      setPhase({ kind: 'reading', fileName: file.name, done: 0, total: 0, startedAt });
      // pdf.js (ok. 1,5 MB) ładowany dopiero przy pierwszym pliku.
      const { extractPdf } = await import('./lib/pdf');
      const pdf = await extractPdf(
        file,
        (done, total) => {
          if (!cancelled()) {
            setPhase({ kind: 'reading', fileName: file.name, done, total, startedAt });
          }
        },
        ctrl.signal,
      );
      if (cancelled()) return;

      const hasText = pdf.pages.some((p) => p.text.trim().length > 0);
      if (!hasText && pdf.images.length === 0) {
        setPhase({ kind: 'error', info: { code: 'NO_TEXT' }, retryFile: null });
        return;
      }

      setPhase({ kind: 'analyzing', fileName: file.name, startedAt });
      const raw = await analyze(buildRequest(file.name, pdf), ctrl.signal);
      // Kontrole deterministyczne na tekście, który przeglądarka już ma (bez kosztu CPU Workera).
      const insight = verifyInsight(raw, pdf);
      if (cancelled()) return;

      const next = addToHistory(insight, undefined, fileHash);
      setHistory(next);
      setPhase({
        kind: 'result',
        insight,
        translations: {},
        notes: pdf.notes,
        historyId: next[0]?.id ?? null,
        file,
        extracted: pdf,
      });
    } catch (e) {
      if (cancelled()) return;
      const retryable = e instanceof ApiError ? e.retryable : !(e instanceof PdfReadError);
      setPhase({ kind: 'error', info: { error: e }, retryFile: retryable ? file : null });
    }
  }, []);

  const reset = () => {
    controller.current?.abort();
    setPhase({ kind: 'empty' });
  };

  const result = phase.kind === 'result' ? phase : null;

  /** Tłumaczenie wyniku: zapisywane w historii, żeby ponowne otwarcie nie zużywało limitu API. */
  const translateResult = async (target: OutputLanguage, signal: AbortSignal): Promise<Insight> => {
    if (!result) throw new Error('Brak wyniku');
    const translated = await translate(result.insight, target, signal);
    if (result.historyId) setHistory(saveTranslation(result.historyId, target, translated));
    setPhase((p) =>
      p.kind === 'result' && p.insight === result.insight
        ? { ...p, translations: { ...p.translations, [target]: translated } }
        : p,
    );
    return translated;
  };

  const translateDocument =
    result && (result.extracted || result.file)
      ? async (
          target: OutputLanguage,
          onProgress: (p: ProgressEvent) => void,
          signal: AbortSignal,
        ): Promise<TranslatedDocument> => {
          let extracted = result.extracted;
          if (!extracted && result.file) {
            // Wynik z pamięci podręcznej: pełny tekst trzeba odczytać z pliku jeszcze raz.
            const { extractPdf } = await import('./lib/pdf');
            extracted = await extractPdf(result.file, undefined, signal);
          }
          if (!extracted) throw new Error('Brak tekstu dokumentu');
          const out = await translateWholeDocument(
            extracted,
            result.insight.document.language,
            target,
            {
              signal,
              onProgress,
              translateChunk: translateDocumentChunk,
            },
          );
          return {
            from: result.insight.document.language,
            to: target,
            model: out.model,
            createdAt: new Date().toISOString(),
            pages: out.pages,
            issues: out.issues,
            scannedPages: out.scannedPages,
          };
        }
      : undefined;

  const busy = phase.kind === 'reading' || phase.kind === 'analyzing';
  const showUpload = phase.kind === 'empty' || phase.kind === 'error';

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead-top">
          <h1>PDF Insight</h1>
          <LanguageSwitch />
        </div>
        <p>{t.appTagline}</p>
      </header>

      <main className="layout">
        <div className="main-col">
          {!isApiConfigured() && (
            <p className="config-warning" role="alert">
              {t.configMissing}
            </p>
          )}

          {showUpload && (
            <UploadZone
              disabled={busy}
              onFile={(f) => {
                void run(f);
              }}
            />
          )}

          {phase.kind === 'error' && (
            <ErrorPanel
              message={'code' in phase.info ? t.errors.NO_TEXT : errorMessage(phase.info.error)}
              details={
                'error' in phase.info && phase.info.error instanceof ApiError
                  ? phase.info.error.details
                  : []
              }
              onReset={reset}
              onRetry={
                phase.retryFile
                  ? () => {
                      if (phase.retryFile) void run(phase.retryFile);
                    }
                  : undefined
              }
            />
          )}

          {phase.kind === 'reading' && (
            <ProgressPanel
              fileName={phase.fileName}
              step="reading"
              pagesDone={phase.done}
              pagesTotal={phase.total}
              startedAt={phase.startedAt}
              onCancel={reset}
            />
          )}
          {phase.kind === 'analyzing' && (
            <ProgressPanel
              fileName={phase.fileName}
              step="analyzing"
              startedAt={phase.startedAt}
              onCancel={reset}
            />
          )}

          {result && (
            <ResultView
              key={result.historyId ?? result.insight.analysis.createdAt}
              insight={result.insight}
              translations={result.translations}
              notes={result.notes}
              onTranslate={translateResult}
              translateDocument={translateDocument}
              errorMessage={errorMessage}
              onReset={reset}
              onReanalyze={
                result.fromCache && result.file
                  ? () => {
                      if (result.file) void run(result.file, true);
                    }
                  : undefined
              }
            />
          )}

          {phase.kind === 'empty' && history.length === 0 && (
            <p className="empty-hint">{t.emptyHint}</p>
          )}
        </div>

        <aside className="side-col">
          <HistoryPanel
            entries={history}
            activeId={result ? result.historyId : null}
            onOpen={(entry) => {
              controller.current?.abort();
              setPhase({
                kind: 'result',
                insight: entry.insight,
                translations: entry.translations ?? {},
                notes: [],
                historyId: entry.id,
              });
            }}
            onRemove={(id) => {
              setHistory(removeFromHistory(id));
            }}
            onClear={() => {
              clearHistory();
              setHistory([]);
            }}
          />
        </aside>
      </main>

      <footer className="footer">
        <p>{t.footer}</p>
        <p className="credit">
          {t.credit}{' '}
          <a
            href={AUTHOR_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Aeternifrigus. ${t.creditLink}`}
          >
            Aeternifrigus
          </a>
        </p>
      </footer>
    </div>
  );
}
