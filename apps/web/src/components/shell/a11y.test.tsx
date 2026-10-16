// @vitest-environment node
import type { EvidenceItem } from '@jio/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SentimentBar } from '@/components/brief/sentiment-bar'
import { TrendArrow } from '@/components/brief/trend-arrow'
import { EvidenceCard } from '@/components/evidence/evidence-card'
import { Header } from './header'

vi.mock('next/navigation', () => import('@/components/shell/test-utils'))

const item: EvidenceItem = {
  postId: 'p1',
  sourceKey: 'reddit',
  lane: 'social',
  url: 'https://reddit.com/r/x/comments/abc',
  publishedAt: '2026-10-16T04:00:00Z',
  text: 'Jio IPO',
  glossEn: null,
  lang: 'en',
  reachScore: 4,
  reachRaw: {},
  sentiment: 'negative',
  topicSlug: 'valuation-price-band',
  entities: [],
  confidence: 'high',
  origin: 'model',
  author: { visible: false, label: 'Reddit user' },
}

describe('accessibility markup', () => {
  it('labels every sentiment segment with count, share and action', () => {
    const out = renderToStaticMarkup(
      <SentimentBar
        counts={{ items: 120, pos: 30, neu: 48, neg: 42, splitShown: true }}
        onOpen={() => {}}
      />,
    )
    expect(out).toContain('aria-label="Negative: 42 posts (35%), open evidence"')
    expect(out).toContain('aria-label="Positive: 30 posts (25%), open evidence"')
    expect(out).toContain('aria-label="Neutral: 48 posts (40%), open evidence"')
  })

  it('opens original posts in a new tab without opener', () => {
    const out = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <EvidenceCard item={item} />
      </QueryClientProvider>,
    )
    expect(out).toContain('target="_blank"')
    expect(out).toMatch(/rel="[^"]*noopener[^"]*noreferrer[^"]*"/)
  })

  it('says up or down in text, not only with an arrow and colour', () => {
    expect(renderToStaticMarkup(<TrendArrow trend="up" deltaPct={12} />)).toContain(
      '<span class="sr-only">up</span>',
    )
    expect(renderToStaticMarkup(<TrendArrow trend="down" deltaPct={-8} />)).toContain(
      '<span class="sr-only">down</span>',
    )
  })

  it('starts the header with a skip link to #main', () => {
    const out = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <Header />
      </QueryClientProvider>,
    )
    const header = out.slice(out.indexOf('<header'))
    expect(header.indexOf('href="#main"')).toBeGreaterThan(-1)
    expect(header.indexOf('href="#main"')).toBeLessThan(header.indexOf('href="/"'))
    expect(out).toContain('Skip to content')
  })
})
