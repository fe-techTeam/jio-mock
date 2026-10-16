import { afterAll, describe, expect, it } from 'vitest'
import { sql as dsql } from 'drizzle-orm'
import { createDb, pingDb } from './client'
import { TEST_DATABASE_URL } from './testing'

const clients: { end: (o?: { timeout?: number }) => Promise<void> }[] = []
afterAll(async () => {
  await Promise.all(clients.map((c) => c.end({ timeout: 5 })))
})

function open(url = TEST_DATABASE_URL, opts?: Parameters<typeof createDb>[1]) {
  const c = createDb(url, opts)
  clients.push(c.sql)
  return c
}

describe('createDb', () => {
  it('runs a query through the raw client', async () => {
    const { sql } = open()
    expect(await sql`select 1 as one`).toEqual([{ one: 1 }])
  })

  it('connects to the test database through drizzle', async () => {
    const { db } = open()
    const rows = await db.execute(dsql`select current_database() as name`)
    expect(rows[0]?.name).toBe('jio_ipo_test')
  })

  it('has the pgvector extension available', async () => {
    const { sql } = open()
    const rows = await sql`select name from pg_available_extensions where name = 'vector'`
    expect(rows).toHaveLength(1)
  })
})

describe('pingDb', () => {
  it('resolves true for a live database', async () => {
    const { sql } = open()
    expect(await pingDb(sql)).toBe(true)
  })

  it('resolves false quickly for an unreachable host', async () => {
    const { sql } = open('postgres://jio:jio@localhost:1/none', { connectTimeoutSec: 1 })
    const t0 = Date.now()
    expect(await pingDb(sql)).toBe(false)
    expect(Date.now() - t0).toBeLessThan(3000)
  })
})
