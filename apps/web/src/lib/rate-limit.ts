// In-memory sliding-window rate limiter. Single process only, which matches the local deployment.
export type RateLimiter = {
  check(key: string, now?: number): { ok: boolean; retryAfterSec: number }
  size(): number
}

export function createRateLimiter(opts: { windowMs: number; max: number }): RateLimiter {
  const hits = new Map<string, number[]>()

  function prune(now: number) {
    const cutoff = now - opts.windowMs
    for (const [k, ts] of hits) {
      const kept = ts.filter((t) => t > cutoff)
      if (kept.length === 0) hits.delete(k)
      else if (kept.length !== ts.length) hits.set(k, kept)
    }
  }

  return {
    check(key, now = Date.now()) {
      prune(now)
      const ts = hits.get(key) ?? []
      if (ts.length >= opts.max) {
        const retryMs = ts[0]! + opts.windowMs - now
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil(retryMs / 1000)) }
      }
      ts.push(now)
      hits.set(key, ts)
      return { ok: true, retryAfterSec: 0 }
    },
    size: () => hits.size,
  }
}

/** Shared limiter for the /api read and write routes: 120 requests a minute per user and address. */
export const apiLimiter = createRateLimiter({ windowMs: 60_000, max: 120 })
