import { formatDateTime, TYPE_LABELS } from '../lib/format';
import type { HistoryEntry } from '../lib/history';

interface Props {
  entries: HistoryEntry[];
  activeId: string | null;
  onOpen: (entry: HistoryEntry) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

export function HistoryPanel({ entries, activeId, onOpen, onRemove, onClear }: Props) {
  if (entries.length === 0) return null;
  return (
    <section className="history" aria-labelledby="history-title">
      <div className="history-head">
        <h2 id="history-title">Ostatnie analizy</h2>
        <button type="button" className="link-button" onClick={onClear}>
          Wyczyść historię
        </button>
      </div>
      <p className="muted small">Zapisane tylko w tej przeglądarce.</p>
      <ul>
        {entries.map((e) => (
          <li key={e.id} className={e.id === activeId ? 'is-active' : undefined}>
            <button
              type="button"
              className="history-open"
              onClick={() => {
                onOpen(e);
              }}
              aria-current={e.id === activeId ? 'true' : undefined}
            >
              <span className="history-name">
                {e.insight.document.title ?? e.insight.document.fileName}
              </span>
              <span className="history-meta">
                {TYPE_LABELS[e.insight.document.type]}, {formatDateTime(e.savedAt)}
              </span>
            </button>
            <button
              type="button"
              className="history-remove"
              aria-label={`Usuń z historii: ${e.insight.document.fileName}`}
              onClick={() => {
                onRemove(e.id);
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
