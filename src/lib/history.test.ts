import { describe, expect, it } from 'vitest';
import { sampleInsight } from './fixtures';
import { addToHistory, HISTORY_LIMIT, loadHistory, removeFromHistory } from './history';

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
