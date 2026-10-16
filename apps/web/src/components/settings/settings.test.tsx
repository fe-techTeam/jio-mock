// @vitest-environment jsdom
import { DEFAULT_CONFIG } from '@jio/core'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithClient, resetNav } from '@/components/shell/test-utils'
import type { ConfigResponse, ConfigTopicsResponse } from '@/app/api/config/_lib/contract'
import { AccessTab } from './access-tab'
import { KeywordsTab } from './keywords-tab'
import { TopicsTab } from './topics-tab'

vi.mock('next/navigation', () => import('@/components/shell/test-utils'))

const CONFIG: ConfigResponse = {
  version: 3,
  savedAt: '2026-10-16T03:00:00Z',
  terms: structuredClone(DEFAULT_CONFIG.terms),
  retentionDays: { raw_json: 30, post_text: 90, authors: 90 },
  minItemsForSplit: 30,
  activeMinItems24h: 10,
  personLevelViews: false,
}
const TOPICS: ConfigTopicsResponse = { seed: [], emerging: [], unclassified: { count24h: 4 } }

type Route = (init: RequestInit | undefined) => { status?: number; body: unknown }
let routes: Record<string, Route>
const fetchMock = vi.fn()

beforeEach(() => {
  resetNav()
  routes = {
    'GET /api/config': () => ({ body: CONFIG }),
    'GET /api/config/topics': () => ({ body: TOPICS }),
    'GET /api/config/audit': () => ({ body: { items: [], nextCursor: null } }),
  }
  fetchMock.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url).split('?')[0]
    const route = routes[`${init?.method ?? 'GET'} ${path}`]
    if (!route) return new Response('{}', { status: 404 })
    const { status = 200, body } = route(init)
    return new Response(JSON.stringify(body), { status })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const calls = (method: string) =>
  fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === method)

describe('KeywordsTab', () => {
  it('shows the bare-jio error for a Jio alias and disables Save', async () => {
    const user = userEvent.setup()
    renderWithClient(<KeywordsTab />)
    const input = await screen.findByLabelText('Add Jio alias')
    await user.type(input, 'jio{Enter}')
    expect(await screen.findByText(/'jio' alone means 'live' in Hindi/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('adds a valid term, marks the draft dirty and saves with the base version', async () => {
    const user = userEvent.setup()
    routes['PATCH /api/config'] = () => ({ body: { ...CONFIG, version: 4 } })
    renderWithClient(<KeywordsTab />)
    await user.type(await screen.findByLabelText('Add negative term'), 'Jio Mart sale{Enter}')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('PATCH')).toHaveLength(1))
    const sent = JSON.parse(String((calls('PATCH')[0]![1] as RequestInit).body))
    expect(sent.baseVersion).toBe(3)
    expect(sent.terms.negative_terms).toContain('Jio Mart sale')
  })

  it('renders the conflict message on 409 and keeps the chips', async () => {
    const user = userEvent.setup()
    routes['PATCH /api/config'] = () => ({
      status: 409,
      body: { error: 'Config changed since you opened it, reload' },
    })
    renderWithClient(<KeywordsTab />)
    await user.type(await screen.findByLabelText('Add negative term'), 'Jio Mart sale{Enter}')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText('Config changed since you opened it, reload'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.getByText('Jio Mart sale')).toBeInTheDocument()
  })

  it('tests the draft against the last 24h', async () => {
    const user = userEvent.setup()
    routes['POST /api/config/test-terms'] = () => ({
      body: {
        total: 120,
        matchedCurrent: 10,
        matchedDraft: 12,
        truncated: false,
        samples: [
          {
            text: 'Jio Moonshot is wild',
            sourceKey: 'reddit',
            publishedAt: '2026-10-16T03:00:00Z',
          },
        ],
      },
    })
    renderWithClient(<KeywordsTab />)
    await user.type(await screen.findByLabelText('Add IPO term'), 'Jio Moonshot{Enter}')
    await user.click(screen.getByRole('button', { name: 'Test against last 24h' }))
    expect(await screen.findByText('Current: 10, draft: 12 of 120 posts')).toBeInTheDocument()
    expect(screen.getByText('Jio Moonshot is wild')).toBeInTheDocument()
  })
})

describe('TopicsTab', () => {
  it('shows the empty Emerging state and the unclassified count', async () => {
    renderWithClient(<TopicsTab />)
    expect(await screen.findByText('Nothing new outside the 10 topics')).toBeInTheDocument()
    expect(screen.getByText(/Unclassified \(24h\): 4/)).toBeInTheDocument()
  })

  it('promotes an Emerging candidate', async () => {
    const user = userEvent.setup()
    routes['GET /api/config/topics'] = () => ({
      body: {
        ...TOPICS,
        seed: [
          {
            slug: 'gmp-grey-market',
            name: 'GMP',
            description: '',
            examplePhrases: [],
            status: 'active',
            items24h: 5,
          },
        ],
        emerging: [
          {
            slug: 'nri-quota',
            name: 'NRI quota',
            description: '',
            createdAt: '2026-10-16T03:00:00Z',
            items24h: 7,
            samples: [
              {
                text: 'एनआरआई कोटा?',
                sourceKey: 'reddit',
                publishedAt: '2026-10-16T03:00:00Z',
                lang: 'hi',
                glossEn: 'NRI allotment question',
              },
            ],
          },
        ],
      },
    })
    routes['POST /api/topics/nri-quota/promote'] = () => ({ body: { ok: true } })
    renderWithClient(<TopicsTab />)
    const card = (await screen.findByTestId('emerging-card')) as HTMLElement
    expect(within(card).getByText('NRI allotment question')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Promote' }))
    await waitFor(() => expect(calls('POST')).toHaveLength(1))
    expect(JSON.parse(String((calls('POST')[0]![1] as RequestInit).body))).toEqual({
      action: 'promote',
    })
  })
})

describe('AccessTab', () => {
  it('renders the person-level switch disabled and sends no request when clicked', async () => {
    const user = userEvent.setup()
    renderWithClient(<AccessTab />)
    const sw = await screen.findByRole('switch', { name: /Person-level views/ })
    expect(sw).toBeDisabled()
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('Person-level views: Off, pending legal review')).toBeInTheDocument()
    const before = fetchMock.mock.calls.length
    await user.click(sw)
    expect(fetchMock.mock.calls.length).toBe(before)
    expect(calls('PATCH')).toHaveLength(0)
  })

  it('shows the audit rows with Load more', async () => {
    const user = userEvent.setup()
    let n = 0
    routes['GET /api/config/audit'] = () =>
      n++ === 0
        ? {
            body: {
              items: [{ at: '2026-10-16T03:00:00Z', kind: 'login', ip: '1.2.3.4', detail: {} }],
              nextCursor: 'c1',
            },
          }
        : {
            body: {
              items: [
                { at: '2026-10-16T02:00:00Z', kind: 'relabel', ip: null, detail: { postId: 'p1' } },
              ],
              nextCursor: null,
            },
          }
    renderWithClient(<AccessTab />)
    expect(await screen.findByText('login')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('relabel')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('validates retention inline and disables Save', async () => {
    const user = userEvent.setup()
    renderWithClient(<AccessTab />)
    const raw = await screen.findByLabelText('Raw payloads (days)')
    await user.clear(raw)
    await user.type(raw, '120')
    expect(await screen.findByText(/cannot exceed post text days/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})
