// Test-only helpers (never imported by app code). Component tests mock next/navigation with
//   vi.mock('next/navigation', () => import('@/components/shell/test-utils'))
// so the mock and the test share the `nav` state below.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { vi } from 'vitest'

export const nav = {
  pathname: '/',
  search: new URLSearchParams(),
  replace: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}

export function resetNav(qs = '', pathname = '/') {
  nav.pathname = pathname
  nav.search = new URLSearchParams(qs)
  nav.replace.mockReset()
  nav.push.mockReset()
  nav.refresh.mockReset()
}

/** The URLSearchParams of the n-th router.replace call (default: the last one). */
export function replacedParams(n = -1): URLSearchParams {
  const calls = nav.replace.mock.calls
  const call = calls.at(n)
  if (!call) throw new Error('router.replace was not called')
  const url = String(call[0])
  const q = url.indexOf('?')
  return new URLSearchParams(q === -1 ? '' : url.slice(q + 1))
}

export function useRouter() {
  return {
    replace: nav.replace,
    push: nav.push,
    refresh: nav.refresh,
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }
}

export function useSearchParams() {
  return nav.search
}

export function usePathname() {
  return nav.pathname
}

export function redirect(url: string): never {
  throw new Error(`redirect ${url}`)
}

export function notFound(): never {
  throw new Error('notFound')
}

export function makeTestClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false, refetchOnWindowFocus: false, gcTime: 0 },
    },
  })
}

export function renderWithClient(
  ui: ReactElement,
  client: QueryClient = makeTestClient(),
): RenderResult & { client: QueryClient } {
  const result = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
  return { ...result, client }
}
