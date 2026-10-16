'use client'

import { ENTITY_KEYS, LANES, type EntityFilter, type LaneFilter } from '@jio/core'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import type { Filters } from '@/lib/api'

type ParamsLike = Pick<URLSearchParams, 'get' | 'toString'>

const ENTITY_VALUES: readonly string[] = ENTITY_KEYS
const LANE_VALUES: readonly string[] = LANES

/** Reads `entity` and `lane` from the URL; unknown values fall back to 'all'. */
export function parseFilters(params: ParamsLike): Filters {
  const e = params.get('entity')
  const l = params.get('lane')
  return {
    entity: e && ENTITY_VALUES.includes(e) ? (e as EntityFilter) : 'all',
    lane: l && LANE_VALUES.includes(l) ? (l as LaneFilter) : 'all',
  }
}

/** Builds `pathname?query` from params, with no trailing '?' when empty. */
export function hrefWith(pathname: string, params: URLSearchParams): string {
  const q = params.toString()
  return q ? `${pathname}?${q}` : pathname
}

/** The page filters plus a setter that rewrites one URL param and keeps every other one. */
export function useFilters() {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const qs = params.toString()
  const filters = useMemo(() => parseFilters(new URLSearchParams(qs)), [qs])

  const setFilter = useCallback(
    <K extends keyof Filters>(key: K, value: Filters[K]) => {
      const next = new URLSearchParams(qs)
      if (value === 'all') next.delete(key)
      else next.set(key, value)
      router.replace(hrefWith(pathname, next), { scroll: false })
    },
    [qs, pathname, router],
  )

  return { filters, setFilter }
}
