'use client'

import type { ReactNode } from 'react'
import { ErrorState } from './error-state'
import { resolveQueryState, type QueryLike } from './resolve-query-state'
import { StaleBanner } from './stale-banner'

/**
 * Renders the right thing for a query: skeleton while loading, an error with retry when nothing
 * was ever loaded, the last good data under an amber banner after a failed refetch, the empty
 * node, or the children.
 */
export function QueryView<T>({
  query,
  isEmpty,
  skeleton,
  errorMessage,
  empty,
  asOf,
  children,
}: {
  query: QueryLike<T> & { refetch: () => unknown }
  isEmpty: (data: T) => boolean
  skeleton: ReactNode
  errorMessage: string
  empty: ReactNode
  asOf: (data: T) => string
  children: (data: T) => ReactNode
}) {
  const state = resolveQueryState(query, isEmpty)
  const retry = () => void query.refetch()
  if (state === 'loading') return <>{skeleton}</>
  if (state === 'error') return <ErrorState message={errorMessage} onRetry={retry} />
  const data = query.data as T
  if (state === 'empty') return <>{empty}</>
  return (
    <>
      {state === 'stale' ? <StaleBanner asOf={asOf(data)} onRetry={retry} /> : null}
      {children(data)}
    </>
  )
}
