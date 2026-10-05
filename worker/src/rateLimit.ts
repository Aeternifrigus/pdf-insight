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

const memoryLimiter = new MemoryRateLimiter(8, 60_000);

export async function isAllowed(env: Env, key: string): Promise<boolean> {
  if (!memoryLimiter.allow(key)) return false;
  if (env.RATE_LIMITER) {
    const { success } = await env.RATE_LIMITER.limit({ key });
    return success;
  }
  return true;
}
