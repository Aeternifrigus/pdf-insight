import { insightSchema, type Insight, type OutputLanguage } from './schema';

export const HISTORY_KEY = 'pdf-insight:history:v1';
const KEY = HISTORY_KEY;
export const HISTORY_LIMIT = 8;

/**
 * Wersja potoku (odczyt PDF + analiza). Podnoszona przy każdej zmianie, która może zmienić wynik
 * dla tego samego pliku. Wynik z historii jest używany ponownie tylko przy zgodnej wersji;
 * inaczej poprawka błędu nie dotarłaby do plików analizowanych wcześniej.
 */
export const PIPELINE_VERSION = 4;

export interface HistoryEntry {
  id: string;
  savedAt: string;
  insight: Insight;
  /** SHA-256 pliku: ten sam plik nie zużywa ponownie limitu API. */
  fileHash?: string;
  pipelineVersion?: number;
  /** Tłumaczenia wyniku (np. na angielski), żeby nie zużywać limitu API ponownie. */
  translations?: Partial<Record<OutputLanguage, Insight>>;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Wczytuje historię; wpisy niezgodne ze schematem są pomijane. */
export function loadHistory(store: StorageLike | null = storage()): HistoryEntry[] {
  if (!store) return [];
  try {
    const raw = store.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return [];
      const e = entry as Record<string, unknown>;
      const insight = insightSchema.safeParse(e.insight);
      if (typeof e.id !== 'string' || typeof e.savedAt !== 'string' || !insight.success) return [];
      const fileHash = typeof e.fileHash === 'string' ? e.fileHash : undefined;
      const pipelineVersion = typeof e.pipelineVersion === 'number' ? e.pipelineVersion : undefined;
      return [
        {
          id: e.id,
          savedAt: e.savedAt,
          insight: insight.data,
          fileHash,
          pipelineVersion,
          translations: parseTranslations(e.translations),
        },
      ];
    });
  } catch {
    return [];
  }
}

function persist(entries: HistoryEntry[], store: StorageLike | null): HistoryEntry[] {
  if (!store) return entries;
  let list = entries;
  // Przy przepełnieniu pamięci usuwamy najstarsze wpisy.
  while (list.length > 0) {
    try {
      store.setItem(KEY, JSON.stringify(list));
      return list;
    } catch {
      list = list.slice(0, -1);
    }
  }
  try {
    store.removeItem(KEY);
  } catch {
    /* pamięć niedostępna: historia działa tylko w tej sesji */
  }
  return entries;
}

export function addToHistory(
  insight: Insight,
  store: StorageLike | null = storage(),
  fileHash?: string,
): HistoryEntry[] {
  const entry: HistoryEntry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: new Date().toISOString(),
    insight,
    fileHash,
    pipelineVersion: PIPELINE_VERSION,
  };
  // Nowa analiza tego samego pliku zastępuje poprzednią zamiast tworzyć duplikat.
  const rest = loadHistory(store).filter((e) => !fileHash || e.fileHash !== fileHash);
  const next = [entry, ...rest].slice(0, HISTORY_LIMIT);
  return persist(next, store);
}

/** Tłumaczenia z pamięci przeglądarki są walidowane jak każdy inny wynik. */
function parseTranslations(raw: unknown): HistoryEntry['translations'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Partial<Record<OutputLanguage, Insight>> = {};
  for (const lang of ['pl', 'en'] as const) {
    const parsed = insightSchema.safeParse((raw as Record<string, unknown>)[lang]);
    if (parsed.success && parsed.data.analysis.translation?.to === lang) out[lang] = parsed.data;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function saveTranslation(
  id: string,
  lang: OutputLanguage,
  translation: Insight,
  store: StorageLike | null = storage(),
): HistoryEntry[] {
  const entries = loadHistory(store).map((e) =>
    e.id === id ? { ...e, translations: { ...e.translations, [lang]: translation } } : e,
  );
  return persist(entries, store);
}

export function findByHash(
  fileHash: string,
  store: StorageLike | null = storage(),
): HistoryEntry | undefined {
  return loadHistory(store).find(
    (e) => e.fileHash === fileHash && e.pipelineVersion === PIPELINE_VERSION,
  );
}

export async function hashFile(file: Blob): Promise<string | undefined> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

export function removeFromHistory(
  id: string,
  store: StorageLike | null = storage(),
): HistoryEntry[] {
  return persist(
    loadHistory(store).filter((e) => e.id !== id),
    store,
  );
}

export function clearHistory(store: StorageLike | null = storage()): void {
  try {
    store?.removeItem(KEY);
  } catch {
    /* brak dostępu do pamięci */
  }
}
