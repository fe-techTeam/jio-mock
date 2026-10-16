'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { hrefWith } from '@/components/shell/use-filters'
import { decodeSlice, encodeSlice, type EvidenceSlice, type EvidenceSliceInput } from './slice'

/** Opens the evidence drawer for a slice by writing the `evidence` param (other params kept). */
export function useOpenEvidence(): (slice: EvidenceSliceInput) => void {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const qs = params.toString()
  return useCallback(
    (slice: EvidenceSliceInput) => {
      const next = new URLSearchParams(qs)
      next.set('evidence', encodeSlice(slice))
      router.replace(hrefWith(pathname, next), { scroll: false })
    },
    [qs, pathname, router],
  )
}

/** Closes the drawer: removes only the `evidence` param. */
export function useCloseEvidence(): () => void {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const qs = params.toString()
  return useCallback(() => {
    const next = new URLSearchParams(qs)
    next.delete('evidence')
    router.replace(hrefWith(pathname, next), { scroll: false })
  }, [qs, pathname, router])
}

/** The slice in the URL, or null when the param is missing or invalid. */
export function useEvidenceSlice(): EvidenceSlice | null {
  return decodeSlice(useSearchParams().get('evidence'))
}
