import { useI18n } from '../i18n/context';
import { formatDateTime } from '../lib/format';
import type { HistoryEntry } from '../lib/history';

interface Props {
  entries: HistoryEntry[];
  activeId: string | null;
  onOpen: (entry: HistoryEntry) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

export function HistoryPanel({ entries, activeId, onOpen, onRemove, onClear }: Props) {
  const { t, locale, lang } = useI18n();
  if (entries.length === 0) return null;
  return (
    <section className="history" aria-labelledby="history-title">
      <div className="history-head">
        <h2 id="history-title">{t.history.title}</h2>
        <button type="button" className="link-button" onClick={onClear}>
          {t.history.clear}
        </button>
      </div>
      <p className="muted small">{t.history.localOnly}</p>
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
                {/* Tytuł w języku interfejsu, jeśli wynik ma takie tłumaczenie. */}
                {e.translations?.[lang]?.document.title ??
                  e.insight.document.title ??
                  e.insight.document.fileName}
              </span>
              <span className="history-meta">
                {t.types[e.insight.document.type]}, {formatDateTime(e.savedAt, locale)}
              </span>
            </button>
            <button
              type="button"
              className="history-remove"
              aria-label={t.history.remove(e.insight.document.fileName)}
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
