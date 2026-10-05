import { useCallback, useEffect, useRef, useState } from 'react';
import { analyze, ApiError, buildRequest, isApiConfigured } from './api/analyze';
import { ErrorPanel } from './components/ErrorPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { ProgressPanel } from './components/ProgressPanel';
import { ResultView } from './components/ResultView';
import { UploadZone } from './components/UploadZone';
import { checkPdfFile, PdfReadError } from './lib/file';
import {
  addToHistory,
  clearHistory,
  findByHash,
  hashFile,
  HISTORY_KEY,
  loadHistory,
  removeFromHistory,
  type HistoryEntry,
} from './lib/history';
import type { Insight } from './lib/schema';

type Phase =
  | { kind: 'empty' }
  | { kind: 'reading'; fileName: string; done: number; total: number; startedAt: number }
  | { kind: 'analyzing'; fileName: string; startedAt: number }
  | { kind: 'error'; message: string; details: string[]; retryFile: File | null }
  | {
      kind: 'result';
      insight: Insight;
      notes: string[];
      historyId: string | null;
      /** Plik, który można przeanalizować ponownie (wynik pochodzi z historii). */
      cachedFile?: File;
    };

export default function App() {
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
      setPhase({ kind: 'error', message: check.message, details: [], retryFile: null });
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
        notes: ['Ten plik był już analizowany. Pokazano zapisany wynik.'],
        historyId: cached.id,
        cachedFile: file,
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
        setPhase({
          kind: 'error',
          message: 'W pliku nie ma tekstu do analizy.',
          details: [],
          retryFile: null,
        });
        return;
      }

      setPhase({ kind: 'analyzing', fileName: file.name, startedAt });
      const insight = await analyze(buildRequest(file.name, pdf), ctrl.signal);
      if (cancelled()) return;

      const notes = pdf.notes;
      const next = addToHistory(insight, undefined, fileHash);
      setHistory(next);
      setPhase({ kind: 'result', insight, notes, historyId: next[0]?.id ?? null });
    } catch (e) {
      if (cancelled()) return;
      if (e instanceof PdfReadError) {
        setPhase({ kind: 'error', message: e.message, details: [], retryFile: null });
      } else if (e instanceof ApiError) {
        setPhase({
          kind: 'error',
          message: e.message,
          details: e.details,
          retryFile: e.retryable ? file : null,
        });
      } else {
        setPhase({
          kind: 'error',
          message: 'Wystąpił nieoczekiwany błąd. Spróbuj ponownie.',
          details: [],
          retryFile: file,
        });
      }
    }
  }, []);

  const reset = () => {
    controller.current?.abort();
    setPhase({ kind: 'empty' });
  };

  const busy = phase.kind === 'reading' || phase.kind === 'analyzing';
  const showUpload = phase.kind === 'empty' || phase.kind === 'error';

  return (
    <div className="app">
      <header className="masthead">
        <h1>PDF Insight</h1>
        <p>Wgraj PDF, a dostaniesz krótkie podsumowanie i dane gotowe do pobrania jako JSON.</p>
      </header>

      <main className="layout">
        <div className="main-col">
          {!isApiConfigured() && (
            <p className="config-warning" role="alert">
              Brak adresu backendu (VITE_API_URL). Analiza nie zadziała, dopóki nie zostanie
              skonfigurowany.
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
              message={phase.message}
              details={phase.details}
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

          {phase.kind === 'result' && (
            <ResultView
              insight={phase.insight}
              notes={phase.notes}
              onReset={reset}
              onReanalyze={
                phase.cachedFile
                  ? () => {
                      if (phase.cachedFile) void run(phase.cachedFile, true);
                    }
                  : undefined
              }
            />
          )}

          {phase.kind === 'empty' && history.length === 0 && (
            <p className="empty-hint">
              Nie masz jeszcze żadnych analiz. Dobrze sprawdzają się umowy, faktury, oferty i
              raporty.
            </p>
          )}
        </div>

        <aside className="side-col">
          <HistoryPanel
            entries={history}
            activeId={phase.kind === 'result' ? phase.historyId : null}
            onOpen={(entry) => {
              controller.current?.abort();
              setPhase({ kind: 'result', insight: entry.insight, notes: [], historyId: entry.id });
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
        <p>
          Tekst pliku (oraz obrazy stron bez warstwy tekstowej) jest wysyłany do zewnętrznego
          dostawcy AI (Google Gemini) w celu analizy. Sam plik PDF nie opuszcza przeglądarki. Demo
          korzysta z darmowego planu API, w którym dostawca może wykorzystywać przesłane treści do
          ulepszania swoich usług. Nie wgrywaj dokumentów poufnych ani danych osobowych.
        </p>
      </footer>
    </div>
  );
}
