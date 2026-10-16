'use client'

import {
  keepPreviousData,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ApiError } from '@/lib/api'

/** Where an expired session goes: the login page's own `reason=expired` alert, then back here. */
export function expiredLoginUrl(location: Pick<Location, 'pathname' | 'search'>): string {
  const params = new URLSearchParams({
    reason: 'expired',
    next: location.pathname + location.search,
  })
  return `/login?${params.toString()}`
}

export function createQueryClient(onUnauthorized: () => void): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (error instanceof ApiError && error.status === 401) onUnauthorized()
      },
    }),
    defaultOptions: {
      queries: {
        refetchInterval: 30_000,
        placeholderData: keepPreviousData,
        staleTime: 15_000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
    },
  })
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() =>
    createQueryClient(() => window.location.assign(expiredLoginUrl(window.location))),
  )
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>{children}</TooltipProvider>
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  )
}
