import postgres from 'postgres'

export function createPinger(url: string) {
  const sql = postgres(url, {
    max: 1,
    connect_timeout: 2,
    idle_timeout: 20,
    onnotice: () => {},
  })
  return {
    async ping(): Promise<void> {
      await sql`select 1`
    },
    async close(): Promise<void> {
      await sql.end({ timeout: 1 })
    },
  }
}

type Pinger = ReturnType<typeof createPinger>
const globalForPinger = globalThis as unknown as { __jioPinger?: Pinger }

export async function pingDb(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  globalForPinger.__jioPinger ??= createPinger(url)
  await globalForPinger.__jioPinger.ping()
}
