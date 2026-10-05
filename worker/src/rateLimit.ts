import type { Env } from './env';

/**
 * Dwuwarstwowy limit żądań:
 * 1. Binding Cloudflare Rate Limiting (jeśli skonfigurowany) - współdzielony między instancjami.
 * 2. Okno przesuwne w pamięci izolatu - działa zawsze, także lokalnie.
 */
export class MemoryRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.prune(now);
    return true;
  }

  private prune(now: number) {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}

/**
 * Analiza i tłumaczenie mają osobne limity: tłumaczenie całego dokumentu to kilkanaście
 * krótkich żądań jednego użytkownika i nie może blokować jego kolejnej analizy (i odwrotnie).
 */
export type LimitScope = 'analyze' | 'translate';

const memoryLimiters: Record<LimitScope, MemoryRateLimiter> = {
  analyze: new MemoryRateLimiter(8, 60_000),
  translate: new MemoryRateLimiter(20, 60_000),
};

export async function isAllowed(
  env: Env,
  key: string,
  scope: LimitScope = 'analyze',
): Promise<boolean> {
  if (!memoryLimiters[scope].allow(key)) return false;
  const binding = scope === 'analyze' ? env.RATE_LIMITER : env.RATE_LIMITER_TRANSLATE;
  if (binding) {
    const { success } = await binding.limit({ key });
    return success;
  }
  return true;
}
