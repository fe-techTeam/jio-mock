'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SourcesPatch } from '@/app/api/sources/_lib/contract'
import { SOURCES_KEY, SourcesApiError, fieldErrors, patchSources } from './sources-api'

/** Mutation shared by the interval editor and the X card. Success refreshes ['sources']. */
export function usePatchSources() {
  const qc = useQueryClient()
  const m = useMutation({
    mutationFn: (body: SourcesPatch) => patchSources(body),
    onSuccess: (data) => {
      qc.setQueryData(SOURCES_KEY, data)
      void qc.invalidateQueries({ queryKey: SOURCES_KEY })
    },
  })
  const err = m.error
  return {
    save: m.mutate,
    saving: m.isPending,
    reset: m.reset,
    errors: fieldErrors(err),
    conflict: err instanceof SourcesApiError && err.status === 409,
    failure:
      err instanceof SourcesApiError && err.status !== 409 && err.status !== 400
        ? err.message
        : err && !(err instanceof SourcesApiError)
          ? 'Could not save'
          : null,
    reload: () => {
      m.reset()
      return qc.invalidateQueries({ queryKey: SOURCES_KEY })
    },
  }
}
