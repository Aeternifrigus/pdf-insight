import { useMemo, useState, type ReactNode } from 'react';
import { downloadJson, jsonFileName } from '../lib/format';
import type { Insight } from '../lib/schema';

/** Prosta kolorystyka składni budowana z elementów React (bez innerHTML). */
function highlight(json: string): ReactNode[] {
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of json.matchAll(re)) {
    if (m.index > last) out.push(json.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(
        <span key={key++} className={m[2] ? 'j-key' : 'j-str'}>
          {m[1]}
        </span>,
      );
      if (m[2]) out.push(m[2]);
    } else if (m[3] !== undefined) {
      out.push(
        <span key={key++} className="j-lit">
          {m[3]}
        </span>,
      );
    } else {
      out.push(
        <span key={key++} className="j-num">
          {m[4]}
        </span>,
      );
    }
    last = m.index + m[0].length;
  }
  out.push(json.slice(last));
  return out;
}

export function JsonPreview({ insight }: { insight: Insight }) {
  const json = useMemo(() => JSON.stringify(insight, null, 2), [insight]);
  const nodes = useMemo(() => highlight(json), [json]);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="json" aria-labelledby="json-title">
      <div className="json-head">
        <h3 id="json-title">Dane JSON</h3>
        <div className="actions">
          <button type="button" className="button button-ghost" onClick={() => void copy()}>
            {copied ? 'Skopiowano' : 'Kopiuj'}
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              downloadJson(insight);
            }}
          >
            Pobierz {jsonFileName(insight.document.fileName)}
          </button>
        </div>
      </div>
      <pre className="json-code" tabIndex={0} aria-label="Podgląd danych JSON">
        <code>{nodes}</code>
      </pre>
    </section>
  );
}
