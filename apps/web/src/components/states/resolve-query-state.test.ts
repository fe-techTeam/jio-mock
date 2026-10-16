import { describe, expect, it } from 'vitest'
import { resolveQueryState } from './resolve-query-state'

const base = { status: 'success' as const, data: undefined, isError: false, isRefetchError: false }
const never = () => false

describe('resolveQueryState', () => {
  it('pending with no data is loading', () => {
    expect(resolveQueryState({ ...base, status: 'pending' }, never)).toBe('loading')
  })
  it('error with no data is error', () => {
    expect(resolveQueryState({ ...base, status: 'error', isError: true }, never)).toBe('error')
  })
  it('data plus a failed refetch is stale, whichever flag reports it', () => {
    const data = { n: 1 }
    expect(
      resolveQueryState({ status: 'error', data, isError: true, isRefetchError: true }, never),
    ).toBe('stale')
    expect(
      resolveQueryState({ status: 'success', data, isError: false, isRefetchError: true }, never),
    ).toBe('stale')
    expect(
      resolveQueryState({ status: 'error', data, isError: true, isRefetchError: false }, never),
    ).toBe('stale')
  })
  it('data that isEmpty accepts is empty', () => {
    expect(resolveQueryState({ ...base, data: [] as number[] }, (d) => d.length === 0)).toBe(
      'empty',
    )
  })
  it('otherwise ready', () => {
    expect(resolveQueryState({ ...base, data: [1] }, (d) => d.length === 0)).toBe('ready')
  })
})
