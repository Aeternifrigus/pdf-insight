import { useEffect, useRef } from 'react';

interface Props {
  message: string;
  details: string[];
  onRetry?: () => void;
  onReset: () => void;
}

export function ErrorPanel({ message, details, onRetry, onReset }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [message]);

  return (
    <section className="panel error" role="alert" aria-labelledby="error-title">
      <h2 id="error-title" ref={headingRef} tabIndex={-1}>
        Analiza się nie udała
      </h2>
      <p>{message}</p>
      {details.length > 0 && (
        <details className="error-details">
          <summary>Szczegóły techniczne</summary>
          <ul>
            {details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="actions">
        {onRetry && (
          <button type="button" className="button button-primary" onClick={onRetry}>
            Spróbuj ponownie
          </button>
        )}
        <button type="button" className="button button-ghost" onClick={onReset}>
          Wybierz inny plik
        </button>
      </div>
    </section>
  );
}
