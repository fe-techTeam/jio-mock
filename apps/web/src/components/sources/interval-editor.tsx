'use client'

import { useState } from 'react'
import type { SourceRow, SourcesPatch } from '@/app/api/sources/_lib/contract'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CONFLICT_TEXT } from './sources-api'
import { usePatchSources } from './use-patch-sources'

type Props = { source: SourceRow; configVersion: number }

/** Inline cadence editor. Portals also edit the market-hours interval. */
export function IntervalEditor({ source, configVersion }: Props) {
  const isPortal = source.marketHoursIntervalMin !== null
  const [interval, setInterval_] = useState(String(source.intervalMin))
  const [market, setMarket] = useState(String(source.marketHoursIntervalMin ?? ''))
  const p = usePatchSources()
  const base = `sources.${source.key}`

  const dirty =
    interval !== String(source.intervalMin) ||
    (isPortal && market !== String(source.marketHoursIntervalMin))

  function submit() {
    const patch: SourcesPatch['sources'] = { [source.key]: {} }
    const entry = patch![source.key]!
    if (interval !== String(source.intervalMin)) entry.interval_min = Number(interval)
    if (isPortal && market !== String(source.marketHoursIntervalMin)) {
      entry.market_hours_interval_min = Number(market)
    }
    p.save({ baseVersion: configVersion, sources: patch })
  }

  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    path: string,
  ) => (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={1440}
        className="h-8 w-20"
        value={value}
        aria-invalid={p.errors[path] ? true : undefined}
        aria-describedby={p.errors[path] ? `${id}-err` : undefined}
        onChange={(e) => set(e.target.value)}
      />
      {p.errors[path] ? (
        <p id={`${id}-err`} role="alert" className="max-w-48 text-xs text-destructive">
          {p.errors[path]}
        </p>
      ) : null}
    </div>
  )

  return (
    <div className="flex flex-wrap items-end gap-2">
      {field(
        `iv-${source.key}`,
        isPortal ? 'otherwise (min)' : 'every (min)',
        interval,
        setInterval_,
        `${base}.interval_min`,
      )}
      {isPortal
        ? field(
            `mh-${source.key}`,
            'market hours (min)',
            market,
            setMarket,
            `${base}.market_hours_interval_min`,
          )
        : null}
      <Button size="sm" variant="outline" disabled={!dirty || p.saving} onClick={submit}>
        Save
      </Button>
      {p.conflict ? (
        <div role="alert" className="flex items-center gap-2 text-xs text-destructive">
          <span>{CONFLICT_TEXT}</span>
          <Button size="xs" variant="outline" onClick={() => void p.reload()}>
            Reload
          </Button>
        </div>
      ) : null}
      {p.failure ? (
        <p role="alert" className="text-xs text-destructive">
          {p.failure}
        </p>
      ) : null}
    </div>
  )
}
