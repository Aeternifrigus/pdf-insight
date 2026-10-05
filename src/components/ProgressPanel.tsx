import { useEffect, useState } from 'react';

export type Step = 'reading' | 'analyzing';

interface Props {
  fileName: string;
  step: Step;
  pagesDone?: number;
  pagesTotal?: number;
  startedAt: number;
  onCancel: () => void;
}

const STEPS: { id: Step | 'upload' | 'result'; label: string }[] = [
  { id: 'upload', label: 'Wgranie pliku' },
  { id: 'reading', label: 'Odczyt tekstu' },
  { id: 'analyzing', label: 'Analiza AI' },
  { id: 'result', label: 'Wynik' },
];

export function ProgressPanel({
  fileName,
  step,
  pagesDone,
  pagesTotal,
  startedAt,
  onCancel,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => {
      clearInterval(t);
    };
  }, []);

  const current = STEPS.findIndex((s) => s.id === step);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const detail =
    step === 'reading'
      ? pagesTotal
        ? `Strona ${pagesDone ?? 0} z ${pagesTotal}`
        : 'Otwieranie pliku'
      : 'Model czyta dokument i wypełnia schemat danych';

  return (
    <section className="panel progress" aria-labelledby="progress-title">
      <h2 id="progress-title" className="progress-file">
        {fileName}
      </h2>
      <ol className="steps">
        {STEPS.map((s, i) => (
          <li
            key={s.id}
            className={i < current ? 'is-done' : i === current ? 'is-active' : undefined}
            aria-current={i === current ? 'step' : undefined}
          >
            <span className="step-dot" aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ol>
      <p className="progress-status">
        <span className="spinner" aria-hidden="true" />
        {/* Tylko opis etapu jest ogłaszany przez czytnik ekranu; licznik sekund nie,
            inaczej czytnik powtarzałby komunikat co sekundę. */}
        <span role="status" aria-live="polite">
          {detail}
        </span>
        <span className="progress-time" aria-hidden="true">
          {' '}
          ({seconds} s)
        </span>
      </p>
      <button type="button" className="button button-ghost" onClick={onCancel}>
        Anuluj
      </button>
    </section>
  );
}
