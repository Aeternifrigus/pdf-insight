import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/context';

export type Step = 'reading' | 'analyzing';

interface Props {
  fileName: string;
  step: Step;
  pagesDone?: number;
  pagesTotal?: number;
  startedAt: number;
  onCancel: () => void;
}

const STEPS = ['upload', 'reading', 'analyzing', 'result'] as const;

export function ProgressPanel({
  fileName,
  step,
  pagesDone,
  pagesTotal,
  startedAt,
  onCancel,
}: Props) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => {
      clearInterval(t);
    };
  }, []);

  const current = STEPS.indexOf(step);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const detail =
    step === 'reading'
      ? pagesTotal
        ? t.progress.page(pagesDone ?? 0, pagesTotal)
        : t.progress.opening
      : t.progress.analyzing;

  return (
    <section className="panel progress" aria-labelledby="progress-title">
      <h2 id="progress-title" className="progress-file">
        {fileName}
      </h2>
      <ol className="steps">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={i < current ? 'is-done' : i === current ? 'is-active' : undefined}
            aria-current={i === current ? 'step' : undefined}
          >
            <span className="step-dot" aria-hidden="true" />
            {t.progress.steps[s]}
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
        {t.progress.cancel}
      </button>
    </section>
  );
}
