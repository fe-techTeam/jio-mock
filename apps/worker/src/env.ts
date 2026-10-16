import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().url(),
  SOURCES_MODE: z.enum(['auto', 'fixture', 'live']).default('auto'),
})

export interface WorkerEnv {
  databaseUrl: string
  sourcesMode: 'auto' | 'fixture' | 'live'
}

/** Adapters read their own API keys later; none are read here. */
export function loadWorkerEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  const e = schema.parse(source)
  return { databaseUrl: e.DATABASE_URL, sourcesMode: e.SOURCES_MODE }
}
