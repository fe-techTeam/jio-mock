// @vitest-environment jsdom
import type { EvidenceItem } from '@jio/core'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithClient, resetNav } from '@/components/shell/test-utils'
import { RelabelControls } from './relabel'

vi.mock('next/navigation', () => import('@/components/shell/test-utils'))

const fetchMock = vi.fn()
const TOPICS = [
  { slug: 'valuation-price-band', name: 'Valuation' },
  { slug: 'gmp-grey-market', name: 'GMP' },
]
const item = {
  postId: 'p1',
  sentiment: 'negative',
  topicSlug: 'valuation-price-band',
  entities: ['jio'],
} as unknown as EvidenceItem

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))
const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)))
const render = () => renderWithClient(<RelabelControls item={item} topics={TOPICS} />)
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')

beforeEach(() => {
  vi.useFakeTimers()
  resetNav()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('RelabelControls', () => {
  it('marks Neutral pressed before the request resolves', async () => {
    let resolve!: (r: Response) => void
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)))
    render()
    expect(pressed('Negative')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Neutral' }))
    await flush()
    expect(pressed('Neutral')).toBe('true')
    expect(pressed('Negative')).toBe('false')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/labels')
    expect(JSON.parse(init.body)).toEqual({
      postId: 'p1',
      origin: 'correction',
      sentiment: 'neutral',
      topicSlug: 'valuation-price-band',
      entities: ['jio'],
    })
    resolve(new Response(JSON.stringify({ ok: true, classificationId: 'c1' }), { status: 200 }))
    await flush()
  })

  it('reverts to Negative and shows the error on a 500', async () => {
    fetchMock.mockReturnValue(json(500, { error: 'db_unavailable' }))
    render()
    fireEvent.click(screen.getByRole('button', { name: 'Neutral' }))
    await flush()
    expect(pressed('Negative')).toBe('true')
    expect(screen.getByText('Could not save label')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('shows Undo for 10 seconds, then hides it', async () => {
    fetchMock.mockReturnValue(json(200, { ok: true, classificationId: 'c1' }))
    render()
    fireEvent.click(screen.getByRole('button', { name: 'Positive' }))
    await flush()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
    await act(async () => void (await vi.advanceTimersByTimeAsync(9_999)))
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
    await act(async () => void (await vi.advanceTimersByTimeAsync(1)))
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('Undo sends DELETE with the returned id and restores the old topic', async () => {
    fetchMock.mockImplementation((_u: string, init: RequestInit) =>
      init.method === 'DELETE'
        ? json(200, { ok: true })
        : json(200, { ok: true, classificationId: 'c9' }),
    )
    render()
    const select = screen.getByLabelText('Topic') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'gmp-grey-market' } })
    await flush()
    expect(select.value).toBe('gmp-grey-market')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await flush()
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/labels/c9',
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(select.value).toBe('valuation-price-band')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('toggles entities', async () => {
    fetchMock.mockReturnValue(json(200, { ok: true, classificationId: 'c1' }))
    render()
    fireEvent.click(screen.getByRole('button', { name: 'Isha' }))
    await flush()
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).entities).toEqual(['jio', 'isha'])
    expect(pressed('Isha')).toBe('true')
  })
})
