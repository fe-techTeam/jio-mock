import { describe, expect, it } from 'vitest'
import { safeNext } from './safe-next'

describe('safeNext', () => {
  it('keeps a same-origin path with its query', () => {
    expect(safeNext('/topics/x?entity=isha')).toBe('/topics/x?entity=isha')
  })
  it.each(['//evil.com', 'https://evil.com', '/\\evil', '/login', '/login?next=/', '', undefined])(
    'falls back to / for %j',
    (v) => {
      expect(safeNext(v)).toBe('/')
    },
  )
})
