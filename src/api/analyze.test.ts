import { describe, expect, it, vi } from 'vitest';
import { withTimeout } from './analyze';

describe('withTimeout', () => {
  it('przerywa po upływie czasu i zgłasza timeout', () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const t = withTimeout(parent.signal, 1000);
    vi.advanceTimersByTime(1001);
    expect(t.signal.aborted).toBe(true);
    expect(t.timedOut()).toBe(true);
    t.dispose();
    vi.useRealTimers();
  });

  it('przekazuje anulowanie przez użytkownika (bez timeoutu)', () => {
    const parent = new AbortController();
    const t = withTimeout(parent.signal, 60_000);
    parent.abort();
    expect(t.signal.aborted).toBe(true);
    expect(t.timedOut()).toBe(false);
    t.dispose();
  });
});
