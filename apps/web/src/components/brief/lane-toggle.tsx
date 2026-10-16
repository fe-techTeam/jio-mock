'use client'

import { LANES, type LaneFilter } from '@jio/core'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export const LANE_OPTIONS: { value: LaneFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'social', label: 'Social' },
  { value: 'media', label: 'Media and analyst' },
]

const LANE_VALUES: readonly string[] = LANES

/** The `lane` URL value as a LaneFilter; anything unknown is 'all'. */
export function parseLane(v: string | null): LaneFilter {
  return v && LANE_VALUES.includes(v) ? (v as LaneFilter) : 'all'
}

/** `pathname?query` with `lane` set ('all' deletes it); every other param is kept. */
export function laneHref(pathname: string, search: URLSearchParams, lane: LaneFilter): string {
  const next = new URLSearchParams(search)
  if (lane === 'all') next.delete('lane')
  else next.set('lane', lane)
  const q = next.toString()
  return q ? `${pathname}?${q}` : pathname
}

/**
 * Lane filter (All / Social / Media and analyst) bound to the `lane` URL param. Queries key on
 * the URL filters, so a change refetches every number on the page.
 */
export function LaneToggle() {
  const search = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const lane = parseLane(search.get('lane'))
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className="text-sm text-muted-foreground">
        Lane
      </span>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        aria-label="Lane"
        value={lane}
        onValueChange={(v) => {
          // Radix sends '' when the active item is pressed again; keep the current choice.
          if (!v || v === lane) return
          router.replace(laneHref(pathname, new URLSearchParams(search.toString()), parseLane(v)), {
            scroll: false,
          })
        }}
      >
        {LANE_OPTIONS.map((o) => (
          <ToggleGroupItem key={o.value} value={o.value} className="px-3">
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

export default LaneToggle
