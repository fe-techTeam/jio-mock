export type QueryViewState = 'loading' | 'error' | 'stale' | 'empty' | 'ready'

export type QueryLike<T> = {
  status: 'pending' | 'error' | 'success'
  data: T | undefined
  isError: boolean
  isRefetchError: boolean
}

/**
 * One rule for every screen. TanStack keeps the last good data when a refetch fails, so data plus
 * an error is 'stale' (show the data under a banner), not 'error'.
 */
export function resolveQueryState<T>(
  q: QueryLike<T>,
  isEmpty: (data: T) => boolean,
): QueryViewState {
  if (q.data === undefined) return q.status === 'error' || q.isError ? 'error' : 'loading'
  if (q.isError || q.isRefetchError) return 'stale'
  return isEmpty(q.data) ? 'empty' : 'ready'
}
