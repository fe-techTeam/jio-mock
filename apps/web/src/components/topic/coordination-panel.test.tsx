import type { TimelineCoordination } from '@jio/core'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeSlice } from '@/components/evidence/slice'
import { replacedParams, resetNav } from '@/components/shell/test-utils'
import {
  CoordinationPanel,
  EMPTY_TEXT,
  burstLabel,
  clusterLabel,
  formatBucketIst,
  panelTitles,
  top5Label,
} from './coordination-panel'

vi.mock('next/navigation', () => import('@/components/shell/test-utils'))

beforeEach(() => resetNav('', '/topics/gmp-grey-market'))
afterEach(() => cleanup())

// Spelled with a character class so a repo grep for the word itself stays empty.
const FORBIDDEN = /o[r]ganic|bot|fake/i

const data: TimelineCoordination = {
  clusters: [
    {
      clusterId: 'nd_abc',
      posts: 6,
      authors: 5,
      firstAt: '2026-10-16T04:00:00Z',
      lastAt: '2026-10-16T04:40:00Z',
      sample: 'Jio IPO allotment is rigged, sell now',
    },
  ],
  bursts: [{ bucketStart: '2026-10-16T04:00:00Z', items: 15, trailingMedian: 2 }],
  top5AuthorShare: 0.52,
}

describe('formatting helpers', () => {
  it('formats a bucket in IST as HH:MM DD Mon', () => {
    expect(formatBucketIst('2026-10-16T04:00:00Z')).toBe('09:30 16 Oct')
  })

  it('describe clusters, bursts and the top-5 share with counts only', () => {
    expect(clusterLabel(data.clusters[0]!)).toBe(
      '6 posts from 5 distinct accounts, 09:30 16 Oct to 10:10 16 Oct',
    )
    expect(burstLabel(data.bursts[0]!)).toBe('15 items vs median 2')
    expect(top5Label(0.52)).toBe('Top-5 authors posted 52% of the last 24h (suspected)')
    expect(top5Label(null)).toBe('Not enough posts in the last 24h (under 30)')
  })

  it('no builder output uses an accusing word (FORBIDDEN), and every title says suspected', () => {
    const outputs = [
      EMPTY_TEXT,
      ...panelTitles,
      clusterLabel(data.clusters[0]!),
      burstLabel(data.bursts[0]!),
      top5Label(0.52),
      top5Label(null),
    ]
    for (const s of outputs) expect(s).not.toMatch(FORBIDDEN)
    for (const t of panelTitles) expect(t.toLowerCase()).toContain('suspected')
  })
})

describe('CoordinationPanel', () => {
  it('renders the empty state', () => {
    render(
      <CoordinationPanel
        slug="gmp-grey-market"
        topicName="GMP"
        data={{ clusters: [], bursts: [], top5AuthorShare: null }}
      />,
    )
    expect(screen.getByText('No suspected coordination in the last 7 days')).toBeTruthy()
  })

  it('renders the empty state when the API sent no coordination block', () => {
    render(<CoordinationPanel slug="gmp-grey-market" topicName="GMP" data={undefined} />)
    expect(screen.getByText(EMPTY_TEXT)).toBeTruthy()
  })

  it('renders three suspected blocks and opens evidence for a cluster and a burst', async () => {
    render(<CoordinationPanel slug="gmp-grey-market" topicName="GMP" data={data} />)
    const region = screen.getByRole('region', { name: /suspected coordination/i })
    for (const t of panelTitles) expect(within(region).getByText(t)).toBeTruthy()
    expect(within(region).getByText(/Jio IPO allotment is rigged/)).toBeTruthy()
    expect(within(region).getByText(/52%/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /Jio IPO allotment/ }))
    expect(decodeSlice(replacedParams().get('evidence'))).toMatchObject({
      topic: 'gmp-grey-market',
      cluster: 'nd_abc',
      coordinated: true,
      window: '7d',
    })

    await userEvent.click(
      screen.getByRole('button', { name: /09:30 16 Oct IST 15 items vs median 2/ }),
    )
    expect(decodeSlice(replacedParams().get('evidence'))).toMatchObject({
      topic: 'gmp-grey-market',
      bucket: '2026-10-16T04:00:00Z',
      window: '7d',
    })
  })
})
