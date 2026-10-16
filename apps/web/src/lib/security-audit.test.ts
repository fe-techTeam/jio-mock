// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const API = path.resolve(__dirname, '../app/api')
const files = (readdirSync(API, { recursive: true }) as string[])
  .filter((f) => f.endsWith('route.ts'))
  .map((f) => f.split(path.sep).join('/'))
const PUBLIC = ['health/route.ts', 'auth/[...all]/route.ts']
const read = (f: string) => readFileSync(path.join(API, f), 'utf8')

describe('api route audit', () => {
  it('finds the routes', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it('every non-public route uses the shared session guard withApi', () => {
    const unguarded = files
      .filter((f) => !PUBLIC.includes(f))
      .filter((f) => !/\bwithApi\b/.test(read(f)))
    expect(unguarded).toEqual([])
  })

  it('has no bulk or author export', () => {
    const bad = files.filter((f) => /text\/csv|Content-Disposition/i.test(read(f)))
    expect(bad).toEqual([])
  })

  it('never selects authors.handle without kind in the same file', () => {
    const bad = files.filter(
      (f) => /authors\.handle|\bhandle\b\s*:\s*authors/.test(read(f)) && !/\bkind\b/.test(read(f)),
    )
    expect(bad).toEqual([])
  })
})
