import { describe, expect, it } from 'vitest';
import { sampleInsight } from './fixtures';
import { addToHistory, findByHash, HISTORY_LIMIT, loadHistory, removeFromHistory } from './history';

function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
    data,
  };
}

describe('history', () => {
  it('zapisuje, odczytuje i usuwa wpisy', () => {
    const store = memoryStore();
    const [entry] = addToHistory(sampleInsight(), store);
    expect(loadHistory(store)).toHaveLength(1);
    removeFromHistory(entry?.id ?? '', store);
    expect(loadHistory(store)).toHaveLength(0);
  });

  it(`przechowuje maksymalnie ${HISTORY_LIMIT} wpisów`, () => {
    const store = memoryStore();
    for (let i = 0; i < HISTORY_LIMIT + 3; i++) addToHistory(sampleInsight(), store);
    expect(loadHistory(store)).toHaveLength(HISTORY_LIMIT);
  });

  it('ten sam plik (hash) zastępuje poprzedni wpis i jest odnajdywany', () => {
    const store = memoryStore();
    addToHistory(sampleInsight(), store, 'abc');
    addToHistory(sampleInsight(), store, 'def');
    addToHistory(sampleInsight(), store, 'abc');
    expect(loadHistory(store)).toHaveLength(2);
    expect(findByHash('abc', store)?.fileHash).toBe('abc');
    expect(findByHash('zzz', store)).toBeUndefined();
  });

  it('wynik od zapasowego dostawcy nie jest używany ponownie dla tego samego pliku', () => {
    const store = memoryStore();
    const insight = sampleInsight();
    addToHistory({ ...insight, analysis: { ...insight.analysis, backup: true } }, store, 'abc');
    expect(loadHistory(store)).toHaveLength(1);
    expect(findByHash('abc', store)).toBeUndefined();
  });

  it('nie używa ponownie wyniku z innej wersji potoku', () => {
    const store = memoryStore();
    store.setItem(
      'pdf-insight:history:v1',
      JSON.stringify([
        {
          id: 'old',
          savedAt: '2026-10-01T10:00:00Z',
          insight: sampleInsight(),
          fileHash: 'abc',
          pipelineVersion: 1,
        },
      ]),
    );
    expect(findByHash('abc', store)).toBeUndefined();
    expect(loadHistory(store)).toHaveLength(1);
  });

  it('wczytuje wpisy zapisane przez starszą wersję (bez nowych pól)', () => {
    const store = memoryStore();
    const old = sampleInsight() as unknown as Record<string, Record<string, unknown>>;
    delete old.analysis?.unreadPages;
    store.setItem(
      'pdf-insight:history:v1',
      JSON.stringify([{ id: 'x', savedAt: '2026-10-01T10:00:00Z', insight: old }]),
    );
    expect(loadHistory(store)[0]?.insight.analysis.unreadPages).toEqual([]);
  });

  it('pomija uszkodzone wpisy niezgodne ze schematem', () => {
    const store = memoryStore();
    store.setItem(
      'pdf-insight:history:v1',
      JSON.stringify([{ id: 'x', savedAt: 'y', insight: { summary: 'zepsute' } }]),
    );
    expect(loadHistory(store)).toEqual([]);
    store.setItem('pdf-insight:history:v1', 'nie-json');
    expect(loadHistory(store)).toEqual([]);
  });
});
