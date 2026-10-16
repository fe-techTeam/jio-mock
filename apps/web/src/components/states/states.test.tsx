// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  CardSkeletons,
  ChartSkeleton,
  EmptyState,
  ErrorState,
  NotEnoughData,
  QueryView,
  SkeletonRows,
  StaleBanner,
  TabSkeleton,
} from '.'

const html = (el: React.ReactElement) => renderToStaticMarkup(el)

describe('StaleBanner', () => {
  it('reads "Could not refresh, showing data as of HH:MM IST" in IST', () => {
    const out = html(<StaleBanner asOf="2026-10-16T04:00:00Z" />)
    expect(out).toContain('Could not refresh, showing data as of 09:30 IST')
    expect(out).toContain('role="status"')
  })
  it('renders a Retry button only when given a handler', () => {
    expect(html(<StaleBanner asOf="2026-10-16T04:00:00Z" />)).not.toContain('Retry')
    expect(html(<StaleBanner asOf="2026-10-16T04:00:00Z" onRetry={() => {}} />)).toContain('Retry')
  })
})

describe('ErrorState', () => {
  it('is an alert with the message and a Retry button', () => {
    const out = html(<ErrorState message="Could not load the brief." onRetry={() => {}} />)
    expect(out).toContain('role="alert"')
    expect(out).toContain('Could not load the brief.')
    expect(out).toContain('Retry')
  })
})

describe('EmptyState', () => {
  it('shows title, description and action', () => {
    const out = html(
      <EmptyState
        title="No posts match this slice"
        description="Try another filter"
        action={<a>go</a>}
      />,
    )
    expect(out).toContain('No posts match this slice')
    expect(out).toContain('Try another filter')
    expect(out).toContain('<a>go</a>')
  })
})

describe('NotEnoughData', () => {
  it('shows n', () => {
    expect(html(<NotEnoughData n={12} />)).toContain('Not enough data (n=12)')
  })
})

describe('skeletons', () => {
  it.each([
    ['SkeletonRows', <SkeletonRows key="a" />],
    ['CardSkeletons', <CardSkeletons key="b" />],
    ['ChartSkeleton', <ChartSkeleton key="c" />],
    ['TabSkeleton', <TabSkeleton key="d" label="Loading keywords" />],
  ])('%s is busy and announces Loading', (_name, el) => {
    const out = html(el)
    expect(out).toContain('aria-busy="true"')
    expect(out).toContain('sr-only')
    expect(out).toContain('Loading')
  })
  it('SkeletonRows renders the requested number of rows', () => {
    expect(html(<SkeletonRows rows={4} />).match(/data-slot="skeleton"/g)).toHaveLength(4)
  })
})

describe('QueryView', () => {
  const q = (over: object) => ({
    status: 'success' as const,
    data: undefined as string[] | undefined,
    isError: false,
    isRefetchError: false,
    refetch: () => {},
    ...over,
  })
  const props = {
    isEmpty: (d: string[]) => d.length === 0,
    skeleton: <p>SKELETON</p>,
    errorMessage: 'Could not load it.',
    empty: <p>EMPTY</p>,
    asOf: () => '2026-10-16T04:00:00Z',
  }
  const render = (query: ReturnType<typeof q>) =>
    html(
      <QueryView query={query} {...props}>
        {(d) => <p>READY {d.join(',')}</p>}
      </QueryView>,
    )

  it('switches on the resolved state', () => {
    expect(render(q({ status: 'pending' }))).toContain('SKELETON')
    expect(render(q({ status: 'error', isError: true }))).toContain('Could not load it.')
    expect(render(q({ data: [] }))).toContain('EMPTY')
    expect(render(q({ data: ['a'] }))).toContain('READY a')
    const stale = render(q({ status: 'error', data: ['a'], isError: true, isRefetchError: true }))
    expect(stale).toContain('Could not refresh, showing data as of 09:30 IST')
    expect(stale).toContain('READY a')
  })
})
