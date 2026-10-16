'use client'

import type { EntityFilter } from '@jio/core'
import type { ReactNode } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useFilters } from './use-filters'

const ENTITY_OPTIONS: { value: EntityFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'mukesh', label: 'Mukesh' },
  { value: 'akash', label: 'Akash' },
  { value: 'isha', label: 'Isha' },
  { value: 'jio', label: 'Jio' },
]

/**
 * Entity filter bound to the `entity` URL param. It filters by who is mentioned in the content,
 * never by author. `children` is a slot for further controls (the lane toggle, 06-01).
 */
export function FilterBar({ children }: { children?: ReactNode }) {
  const { filters, setFilter } = useFilters()
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-2">
        <span id="entity-filter-label" className="text-sm text-muted-foreground">
          Mentions
        </span>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-labelledby="entity-filter-label"
          value={filters.entity}
          onValueChange={(v) => {
            // Radix sends '' when the active item is pressed again; keep the current choice.
            if (v) setFilter('entity', v as EntityFilter)
          }}
        >
          {ENTITY_OPTIONS.map((o) => (
            <ToggleGroupItem key={o.value} value={o.value} className="px-3">
              {o.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {children}
    </div>
  )
}
