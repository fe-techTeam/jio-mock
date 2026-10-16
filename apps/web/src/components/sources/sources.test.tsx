// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SourceRow, SourcesResponse, XCard } from '@/app/api/sources/_lib/contract'
import { IntervalEditor } from './interval-editor'
import { QuotaCard, quotaText } from './quota-card'
import { SourcesTable, coverageText, whenText } from './sources-table'
import { StatusBadge, modeText, statusLabel } from './status-badge'
import { XConfigCard } from './x-config-card'

vi.mock('next/navigation', () => import('@/components/shell/test-utils'))

const row = (over: Partial<SourceRow> = {}): SourceRow => ({
  key: 'reddit',
  name: 'Reddit',
  lane: 'social',
  enabled: true,
  status: 'ok',
  mode: 'fixture',
  missingCreds: ['REDDIT_CLIENT_ID'],
  coverageLabel: 'full',
  intervalMin: 15,
  marketHoursIntervalMin: null,
  effectiveIntervalMin: 15,
  lastSuccessAt: '2026-10-16T04:00:00Z',
  lastErrorAt: null,
  lastError: null,
  nextRunAt: '2026-10-16T04:15:00Z',
  consecutiveFailures: 0,
  items24h: 4,
  spendTodayUsd: 0.1,
  ...over,
})

const wrap = (ui: ReactElement) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const reply = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body })

beforeEach(() => {
  vi.unstubAllGlobals()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('status helpers', () => {
  it.each([
    ['ok', 'OK'],
    ['stale', 'Stale'],
    ['circuit_open', 'Circuit open'],
    ['waiting', 'Waiting for first run'],
    ['disabled', 'Disabled'],
  ] as const)('badge text for %s', (s, text) => {
    expect(statusLabel(s)).toBe(text)
    render(<StatusBadge status={s} />)
    expect(screen.getByText(text)).toBeInTheDocument()
  })
  it('mode text names missing credentials', () => {
    expect(modeText('fixture', ['A', 'B'])).toBe('Not configured: missing A, B')
    expect(modeText('live', [])).toBe('live')
  })
  it('formats IST times and coverage', () => {
    expect(whenText('2026-10-16T04:00:00Z')).toBe('09:30, 16 Oct')
    expect(whenText(null)).toBe('-')
    expect(coverageText('sampled')).toBe('sampled, not representative')
  })
})

describe('SourcesTable', () => {
  it('shows the circuit-open error and fixture reason', () => {
    const data = {
      configVersion: 1,
      sources: [row({ status: 'circuit_open', lastError: 'boom 500' })],
    } as unknown as SourcesResponse
    wrap(<SourcesTable data={data} />)
    expect(screen.getByText('Circuit open')).toBeInTheDocument()
    expect(screen.getAllByText('boom 500').length).toBeGreaterThan(0)
    expect(screen.getByText('Not configured: missing REDDIT_CLIENT_ID')).toBeInTheDocument()
  })
  it('lazily loads the last runs on expand', async () => {
    vi.stubGlobal(
      'fetch',
      reply(200, [
        {
          at: '2026-10-16T04:00:00Z',
          status: 'ok',
          durationMs: 1500,
          itemsNew: 3,
          costUsd: 0.01,
          error: null,
        },
      ]),
    )
    const data = { configVersion: 1, sources: [row()] } as unknown as SourcesResponse
    wrap(<SourcesTable data={data} />)
    expect(fetch).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /last runs for Reddit/ }))
    expect(await screen.findByText('1.5 s')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/sources/reddit/runs', expect.anything())
  })
})

describe('IntervalEditor', () => {
  it('renders the 400 field error and keeps the typed value', async () => {
    vi.stubGlobal(
      'fetch',
      reply(400, {
        error: 'bad_request',
        issues: [
          { path: ['sources', 'reddit', 'interval_min'], code: 'x', message: 'Must be 1 to 1440' },
        ],
      }),
    )
    wrap(<IntervalEditor source={row()} configVersion={3} />)
    const input = screen.getByLabelText('every (min)')
    await userEvent.clear(input)
    await userEvent.type(input, '0')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Must be 1 to 1440')).toBeInTheDocument()
    expect(input).toHaveValue(0)
    const sent = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string)
    expect(sent).toEqual({ baseVersion: 3, sources: { reddit: { interval_min: 0 } } })
  })

  it('renders the 409 reload message and reload refetches', async () => {
    vi.stubGlobal('fetch', reply(409, { error: 'Config changed since you opened it, reload' }))
    wrap(<IntervalEditor source={row()} configVersion={3} />)
    const input = screen.getByLabelText('every (min)')
    await userEvent.clear(input)
    await userEvent.type(input, '9')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText('Config changed since you opened it, reload'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() =>
      expect(
        screen.queryByText('Config changed since you opened it, reload'),
      ).not.toBeInTheDocument(),
    )
  })

  it('portals show both inputs', () => {
    wrap(
      <IntervalEditor
        source={row({ key: 'portal_ipowatch', marketHoursIntervalMin: 10, intervalMin: 60 })}
        configVersion={1}
      />,
    )
    expect(screen.getByLabelText('market hours (min)')).toHaveValue(10)
    expect(screen.getByLabelText('otherwise (min)')).toHaveValue(60)
  })
})

describe('XConfigCard', () => {
  const x = (credsSet: boolean): XCard => ({
    tier: 'basic',
    rateLimits: { max_pages_per_run: 3 },
    credsSet,
    modeLabel: credsSet ? 'Official API' : 'Apify fallback',
  })
  it.each([true, false])('token input is always empty (credsSet=%s)', (credsSet) => {
    wrap(<XConfigCard x={x(credsSet)} configVersion={1} />)
    const input = screen.getByLabelText(/Bearer token/)
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(input).toHaveAttribute(
      'placeholder',
      credsSet ? 'Saved - enter a new token to replace' : 'Not set',
    )
    expect(screen.queryByRole('button', { name: 'Clear token' }) !== null).toBe(credsSet)
  })

  it('sends the token only when typed and clears the field after saving', async () => {
    vi.stubGlobal('fetch', reply(200, { configVersion: 2, sources: [] }))
    wrap(<XConfigCard x={x(false)} configVersion={1} />)
    const input = screen.getByLabelText(/Bearer token/)
    await userEvent.type(input, 'a'.repeat(30))
    await userEvent.click(screen.getByRole('button', { name: 'Save X settings' }))
    await waitFor(() => expect(input).toHaveValue(''))
    const sent = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string)
    expect(sent.x.bearerToken).toBe('a'.repeat(30))
  })

  it('Clear token confirms then sends null', async () => {
    vi.stubGlobal('fetch', reply(200, { configVersion: 2, sources: [] }))
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    wrap(<XConfigCard x={x(true)} configVersion={1} />)
    await userEvent.click(screen.getByRole('button', { name: 'Clear token' }))
    const sent = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string)
    expect(sent).toEqual({ baseVersion: 1, x: { bearerToken: null } })
  })
})

describe('QuotaCard', () => {
  it('shows used / limit and Not reported', () => {
    const q = { unitsUsedToday: 4321, limit: 10000, resetsAt: '2026-10-16T07:00:00Z' }
    expect(quotaText(q)).toBe('YouTube units used today: 4,321 / 10,000')
    expect(quotaText({ ...q, unitsUsedToday: null })).toContain('Not reported')
    render(<QuotaCard quota={q} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '4321')
  })
})
