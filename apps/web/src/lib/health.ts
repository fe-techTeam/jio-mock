// Defined locally: packages/core/src/api-types.ts does not exist yet.
// Phase 01-01 adds HealthResponse there and Phase 04-01 switches this import.
export type HealthResponse = { ok: true; db: 'up' | 'down' }

export async function checkHealth(
  ping: () => Promise<void>,
  timeoutMs = 2000,
): Promise<HealthResponse> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
  })
  try {
    await Promise.race([ping(), timeout])
    return { ok: true, db: 'up' }
  } catch {
    return { ok: true, db: 'down' }
  } finally {
    clearTimeout(timer)
  }
}
