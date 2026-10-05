import { useEffect, useRef } from 'react';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  languageName,
  pagesLabel,
  TYPE_LABELS,
} from '../lib/format';
import type { Insight } from '../lib/schema';
import { JsonPreview } from './JsonPreview';

interface Props {
  insight: Insight;
  notes: string[];
  onReset: () => void;
}

function Empty({ children }: { children: string }) {
  return <p className="muted">{children}</p>;
}

export function ResultView({ insight, notes, onReset }: Props) {
  const { document: doc, analysis } = insight;
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [insight]);

  return (
    <article className="result" aria-labelledby="result-title">
      <header className="result-head">
        <p className="result-file">{doc.fileName}</p>
        <h2 id="result-title" ref={headingRef} tabIndex={-1}>
          {doc.title ?? doc.fileName}
        </h2>
        <dl className="facts">
          <div>
            <dt>Typ</dt>
            <dd>{TYPE_LABELS[doc.type]}</dd>
          </div>
          <div>
            <dt>Data</dt>
            <dd>{doc.date ? formatDate(doc.date) : 'nie podano'}</dd>
          </div>
          <div>
            <dt>Objętość</dt>
            <dd>{pagesLabel(doc.pages)}</dd>
          </div>
          <div className={analysis.unreadPages.length > 0 ? 'fact-warn' : undefined}>
            <dt>Przeanalizowano</dt>
            <dd>
              {analysis.unreadPages.length > 0
                ? `${String(doc.pages - analysis.unreadPages.length)} z ${String(doc.pages)} stron`
                : 'cały dokument'}
            </dd>
          </div>
          <div>
            <dt>Język</dt>
            <dd>{languageName(doc.language)}</dd>
          </div>
        </dl>
      </header>

      {(analysis.warnings.length > 0 || notes.length > 0) && (
        <aside className="warnings" aria-label="Ostrzeżenia">
          <h3>Na co uważać</h3>
          <ul>
            {[...analysis.warnings, ...notes].map((w, i) => (
              <li key={`${String(i)}-${w}`}>{w}</li>
            ))}
          </ul>
        </aside>
      )}

      <section className="block" aria-labelledby="summary-title">
        <h3 id="summary-title">Podsumowanie</h3>
        <p className="summary" lang={doc.language}>
          {insight.summary}
        </p>
      </section>

      <section className="block" aria-labelledby="points-title">
        <h3 id="points-title">Najważniejsze punkty</h3>
        <ul className="points" lang={doc.language}>
          {insight.keyPoints.map((p, i) => (
            <li key={`${String(i)}-${p}`}>{p}</li>
          ))}
        </ul>
      </section>

      <div className="grid">
        <section className="block" aria-labelledby="amounts-title">
          <h3 id="amounts-title">Kwoty ({insight.amounts.length})</h3>
          {insight.amounts.length === 0 ? (
            <Empty>Dokument nie zawiera kwot.</Empty>
          ) : (
            <div
              className="table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Tabela kwot (przewijana)"
            >
              <table className="amounts">
                <thead>
                  <tr>
                    <th scope="col">Kwota</th>
                    <th scope="col">Czego dotyczy</th>
                  </tr>
                </thead>
                <tbody lang={doc.language}>
                  {insight.amounts.map((a, i) => (
                    <tr key={`${String(i)}-${a.currency}-${String(a.value)}`}>
                      <td className="amount">
                        <mark>{formatMoney(a.value, a.currency)}</mark>
                      </td>
                      <td>{a.context}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="block" aria-labelledby="dates-title">
          <h3 id="dates-title">Daty ({insight.dates.length})</h3>
          {insight.dates.length === 0 ? (
            <Empty>Dokument nie zawiera dat.</Empty>
          ) : (
            <ol className="timeline" lang={doc.language}>
              {insight.dates.map((d, i) => (
                <li key={`${String(i)}-${d.date}`}>
                  <time dateTime={d.date}>{formatDate(d.date)}</time>
                  <span>{d.context}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <div className="grid">
        <section className="block" aria-labelledby="orgs-title">
          <h3 id="orgs-title">Organizacje</h3>
          {insight.entities.organizations.length === 0 ? (
            <Empty>Brak nazw organizacji.</Empty>
          ) : (
            <ul className="plain">
              {insight.entities.organizations.map((o, i) => (
                <li key={`${String(i)}-${o}`}>{o}</li>
              ))}
            </ul>
          )}
          <h3 id="people-title" className="subhead">
            Osoby
          </h3>
          {insight.entities.people.length === 0 ? (
            <Empty>Brak nazwisk.</Empty>
          ) : (
            <ul className="plain">
              {insight.entities.people.map((p, i) => (
                <li key={`${String(i)}-${p}`}>{p}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="block" aria-labelledby="keywords-title">
          <h3 id="keywords-title">Słowa kluczowe</h3>
          {insight.keywords.length === 0 ? (
            <Empty>Brak słów kluczowych.</Empty>
          ) : (
            <ul className="tags" lang={doc.language}>
              {insight.keywords.map((k, i) => (
                <li key={`${String(i)}-${k}`}>{k}</li>
              ))}
            </ul>
          )}
          <p className="meta">
            Model: {analysis.model}. Przeanalizowano {formatDateTime(analysis.createdAt)}
            {analysis.chunks > 1 ? `, w ${analysis.chunks} częściach` : ''}
            {analysis.ocrPages.length > 0
              ? `. Strony odczytane ze skanu: ${analysis.ocrPages.join(', ')}`
              : ''}
            .
          </p>
        </section>
      </div>

      <JsonPreview insight={insight} />

      <div className="actions result-actions">
        <button type="button" className="button button-ghost" onClick={onReset}>
          Przeanalizuj kolejny plik
        </button>
      </div>
    </article>
  );
}
