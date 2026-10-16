// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccuracyResponse } from '@/app/api/accuracy/_lib/compute'
import type { QueueResponse } from '@/app/api/labels/_lib/contract'
import { renderWithClient, resetNav } from '@/components/shell/test-utils'
import { AccuracyView } from './accuracy-view'

vi.mock('next/navigation', () => import('@/components/shell/test-utils'))

const fetchMock = vi.fn()
const byLang = { en: null, hinglish: null, hi: null, gu: null, other: null }
const unmeasured = (labelled = 37): AccuracyResponse => ({
  labelled,
  target: 200,
  measured: false,
  unscored: 0,
  overall: null,
  byLang,
  confusion: null,
  sarcasm: null,
  promptVersion: 'v1',
  promptAt: '2026-10-16T04:00:00Z',
  corrections: { count: 3, usedAsFewShot: 3 },
})
const measured = (over: Partial<AccuracyResponse> = {}): AccuracyResponse => ({
  ...unmeasured(200),
  measured: true,
  overall: { sentiment: 0.8, topic: 0.9, entitiesExact: 0.7 },
  byLang: {
    ...byLang,
    en: { n: 50, sentiment: 0.9, topic: 0.95 },
    hinglish: { n: 50, sentiment: 0.7, topic: 0.8 },
  },
  confusion: [
    [40, 5, 5],
    [4, 30, 6],
    [3, 2, 105],
  ],
  sarcasm: { n: 4, sentiment: 0.5 },
  ...over,
})
const ITEM = {
  postId: '6f1c2b1e-8a43-4f5e-9a8e-0d5b8e1f2a3c',
  text: 'Jio IPO kab aayega',
  lang: 'hinglish' as const,
  glossEn: 'When will the Jio IPO come',
  sourceKey: 'reddit',
  publishedAt: '2026-10-16T04:00:00Z',
  url: 'https://reddit.com/x',
}
const queueOf = (item: QueueResponse['item'], labelled = 37): QueueResponse => ({
  item,
  progress: { labelled, target: 200, byLang: { en: 10, hinglish: 9, hi: 9, gu: 9, other: 0 } },
  topics: [
    { slug: 'valuation-price-band', name: 'Valuation' },
    { slug: 'gmp-grey-market', name: 'GMP' },
  ],
})
const ok = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))

function route(opts: {
  accuracy: AccuracyResponse
  queue: QueueResponse
  latest?: AccuracyResponse
}) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url.startsWith('/api/accuracy')) {
      return ok(url.includes('promptVersion=latest') && opts.latest ? opts.latest : opts.accuracy)
    }
    if (url.startsWith('/api/labels/queue')) return ok(opts.queue)
    if (url === '/api/labels' && init?.method === 'POST') {
      return ok({ ok: true, classificationId: 'c1' })
    }
    return ok({ error: 'unexpected' }, 500)
  })
}
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]))

beforeEach(() => {
  resetNav()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Accuracy page', () => {
  it('not measured: shows progress and no percentage anywhere', async () => {
    route({ accuracy: unmeasured(), queue: queueOf(ITEM) })
    const { container } = renderWithClient(<AccuracyView />)
    await screen.findByText('Not measured yet: 37 of 200 labelled')
    await screen.findByText('Jio IPO kab aayega')
    expect(container.textContent).not.toMatch(/%/)
    expect(screen.queryByText('By language')).toBeNull()
    expect(screen.getByText('37 / 200')).toBeTruthy()
  })

  it('measured: shows overall, language table, confusion matrix and sarcasm', async () => {
    route({ accuracy: measured(), queue: queueOf(null, 200) })
    renderWithClient(<AccuracyView />)
    await screen.findByText('Sentiment accuracy')
    expect(screen.getByText('Sentiment accuracy').nextElementSibling?.textContent).toBe('80.0%')
    expect(screen.getByText('Topic accuracy').nextElementSibling?.textContent).toBe('90.0%')
    expect(screen.getByText('Hinglish', { selector: 'td' })).toBeTruthy()
    expect(screen.getAllByText('n/a').length).toBeGreaterThan(0)
    expect(screen.getByText('Sarcasm subset: 4 posts, sentiment 50.0%')).toBeTruthy()
    expect(screen.getByText('3 dashboard relabels, 3 used as few-shot examples')).toBeTruthy()
    expect(screen.getByText('110')).toBeTruthy() // positive gold row total
  })

  it('key 2 selects Neutral', async () => {
    route({ accuracy: unmeasured(), queue: queueOf(ITEM) })
    renderWithClient(<AccuracyView />)
    await screen.findByText('Jio IPO kab aayega')
    fireEvent.keyDown(window, { key: '2' })
    expect(screen.getByRole('button', { name: /Neutral/ }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })

  it('Save posts origin gold with the chosen labels and the sarcastic flag', async () => {
    route({ accuracy: unmeasured(), queue: queueOf(ITEM) })
    renderWithClient(<AccuracyView />)
    await screen.findByText('Jio IPO kab aayega')
    expect(
      (screen.getByRole('button', { name: 'Save and next' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.keyDown(window, { key: '3' })
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'gmp-grey-market' } })
    fireEvent.click(screen.getByRole('button', { name: 'Isha' }))
    fireEvent.click(screen.getByLabelText('Sarcastic'))
    fireEvent.click(screen.getByRole('button', { name: 'Save and next' }))
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === '/api/labels')).toBe(true))
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/labels')!
    expect(JSON.parse(call[1].body)).toEqual({
      postId: ITEM.postId,
      origin: 'gold',
      sentiment: 'positive',
      topicSlug: 'gmp-grey-market',
      entities: ['isha'],
      sarcastic: true,
    })
    // The queue and accuracy are refetched after saving.
    await waitFor(() =>
      expect(urls().filter((u) => u.startsWith('/api/labels/queue')).length).toBeGreaterThan(1),
    )
  })

  it('Skip requests the queue with the skipped id in exclude', async () => {
    route({ accuracy: unmeasured(), queue: queueOf(ITEM) })
    renderWithClient(<AccuracyView />)
    await screen.findByText('Jio IPO kab aayega')
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(urls().some((u) => u.includes(`exclude=${ITEM.postId}`))).toBe(true))
  })

  it('complete state shows Re-score, which fetches promptVersion=latest', async () => {
    route({
      accuracy: measured(),
      queue: queueOf(null, 200),
      latest: measured({ unscored: 30, promptVersion: 'v2' }),
    })
    renderWithClient(<AccuracyView />)
    await screen.findByText('Gold set complete')
    fireEvent.click(screen.getByRole('button', { name: 'Re-score' }))
    await screen.findByText('30 of 200 not yet re-classified with prompt v2')
    expect(urls().some((u) => u.includes('promptVersion=latest'))).toBe(true)
  })

  it('below 200 with no posts says there is nothing to label', async () => {
    route({ accuracy: unmeasured(0), queue: queueOf(null, 0) })
    renderWithClient(<AccuracyView />)
    await screen.findByText('No live posts to label yet')
  })

  it('shows a retry panel when the queue fails', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.startsWith('/api/accuracy') ? ok(unmeasured()) : ok({ error: 'x' }, 503),
    )
    renderWithClient(<AccuracyView />)
    await screen.findByText('Could not load the labelling queue.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})
