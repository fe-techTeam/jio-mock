// Tiny in-process TTL memo for route bodies. One in-flight promise is shared per key, rejections
// are never cached, and the store holds at most MAX_KEYS keys (oldest evicted first).
const MAX_KEYS = 200

type Entry = { at: number; promise: Promise<unknown> }
const store = new Map<string, Entry>()

export function memo<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  const t = now()
  const hit = store.get(key)
  if (hit && t - hit.at < ttlMs) return hit.promise as Promise<T>

  let promise: Promise<T>
  try {
    promise = Promise.resolve(fn())
  } catch (e) {
    promise = Promise.reject(e)
  }
  const entry: Entry = { at: t, promise }
  store.delete(key)
  store.set(key, entry)
  while (store.size > MAX_KEYS) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
  promise.catch(() => {
    if (store.get(key) === entry) store.delete(key)
  })
  return promise
}

/** Empties the memo (tests). */
export function clearMemo(): void {
  store.clear()
}
