import { describe, expect, it } from 'vitest'
import { cn } from './utils'

const skip = false as boolean

describe('cn', () => {
  it('lets the later tailwind class win', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })
  it('drops falsy values', () => {
    expect(cn('a', skip && 'b')).toBe('a')
  })
})
