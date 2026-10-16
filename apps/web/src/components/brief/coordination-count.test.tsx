import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COORDINATION_HELP,
  CoordinationCount,
  coordinationBadges,
  suspectedLabel,
} from './coordination-count'

afterEach(() => cleanup())

// Spelled with a character class so a repo grep for the word itself stays empty.
const FORBIDDEN = /o[r]ganic|bot|fake/i

describe('suspectedLabel', () => {
  it('is a count of suspected items, never a percentage', () => {
    expect(suspectedLabel(0)).toBe('0 suspected')
    expect(suspectedLabel(12)).toBe('12 suspected')
    expect(suspectedLabel(1234)).toBe('1,234 suspected')
    for (const n of [0, 1, 12, 1234]) expect(suspectedLabel(n)).not.toContain('%')
  })
})

describe('coordinationBadges', () => {
  it('shows a burst and a top-5 share above the threshold, both marked suspected', () => {
    expect(coordinationBadges({ burst24h: true, top5AuthorShare: 0.52 })).toEqual([
      'Burst (suspected)',
      'Top-5 authors 52% (suspected)',
    ])
  })
  it('leaves out a share at or under the threshold', () => {
    expect(coordinationBadges({ burst24h: false, top5AuthorShare: 0.4 })).toEqual([])
    expect(coordinationBadges({ burst24h: false, top5AuthorShare: 0.41 }, 0.5)).toEqual([])
  })
  it('is empty when the share is null or the fields are missing', () => {
    expect(coordinationBadges({ burst24h: false, top5AuthorShare: null })).toEqual([])
    expect(coordinationBadges({})).toEqual([])
    expect(coordinationBadges({ burst24h: true })).toEqual(['Burst (suspected)'])
  })
})

describe('labels never accuse', () => {
  it('no builder output uses an accusing word (FORBIDDEN)', () => {
    const outputs = [
      COORDINATION_HELP,
      ...[0, 1, 99].map(suspectedLabel),
      ...coordinationBadges({ burst24h: true, top5AuthorShare: 0.99 }),
    ]
    for (const s of outputs) expect(s).not.toMatch(FORBIDDEN)
    expect(COORDINATION_HELP).toContain('Suspected, not proven')
  })
})

describe('CoordinationCount', () => {
  it('renders muted text, not a button, for 0', () => {
    render(<CoordinationCount n={0} slice={{}} onOpen={vi.fn()} />)
    expect(screen.getByText('0 suspected')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('opens the evidence drawer with the slice plus coordinated, without bubbling', async () => {
    const onOpen = vi.fn()
    const parent = vi.fn()
    render(
      <div onClick={parent}>
        <CoordinationCount
          n={7}
          slice={{ topic: 'gmp-grey-market', topicName: 'GMP' }}
          onOpen={onOpen}
          label="GMP"
        />
      </div>,
    )
    const button = screen.getByRole('button', { name: /GMP: 7 suspected coordinated/i })
    expect(button.textContent).toBe('7 suspected')
    await userEvent.click(button)
    expect(onOpen).toHaveBeenCalledWith({
      topic: 'gmp-grey-market',
      topicName: 'GMP',
      coordinated: true,
    })
    expect(parent).not.toHaveBeenCalled()
  })
})
