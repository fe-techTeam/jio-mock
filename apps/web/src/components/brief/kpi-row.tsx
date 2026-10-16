'use client'

import type { BriefKpis, Trend } from '@jio/core'
import type { ReactNode } from 'react'
import type { EvidenceSliceInput } from '@/components/evidence/slice'
import { formatCount } from '@/components/shell/format'
import { CoordinationCount } from './coordination-count'
import { ReachSplitView } from './reach-split'
import { TrendArrow } from './trend-arrow'

/** Same rule as the API's topic trend (10% threshold; no prior items -> 'new'). */
function kpiTrend(cur: number, prev: number): { trend: Trend; deltaPct: number | null } {
  if (prev === 0) return { trend: cur > 0 ? 'new' : 'flat', deltaPct: null }
  const deltaPct = Math.round(((cur - prev) / prev) * 1000) / 10
  return { trend: deltaPct >= 10 ? 'up' : deltaPct <= -10 ? 'down' : 'flat', deltaPct }
}

function Kpi({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

const numberButton =
  'w-fit rounded-sm text-left text-2xl font-semibold tabular-nums underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'

export function KpiRow({
  kpis,
  onOpen,
}: {
  kpis: BriefKpis
  onOpen: (slice: EvidenceSliceInput) => void
}) {
  const change = kpiTrend(kpis.items24h, kpis.itemsPrev24h)
  return (
    <section
      aria-label="Key figures"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
    >
      <Kpi label="Items in 24h">
        <button
          type="button"
          className={numberButton}
          aria-label={`Items in 24h: ${kpis.items24h}`}
          onClick={() => onOpen({ window: '24h' })}
        >
          {formatCount(kpis.items24h)}
        </button>
      </Kpi>

      <Kpi label="Sentiment">
        {/* Reach-weighted headline (06-01) with the raw count split and n beside it. */}
        <ReachSplitView
          reach={kpis.splitShown ? kpis.reach : null}
          raw={kpis.splitShown ? kpis : null}
          n={kpis.items24h}
          onOpen={(sentiment) => onOpen({ sentiment })}
        />
      </Kpi>

      <Kpi label="Change vs prior 24h">
        <button
          type="button"
          className="flex w-fit items-center gap-2 rounded-sm text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Change vs prior 24h, from ${kpis.itemsPrev24h} items`}
          onClick={() => onOpen({ window: '7d' })}
        >
          <TrendArrow trend={change.trend} deltaPct={change.deltaPct} />
          <span className="text-xs text-muted-foreground">
            from {formatCount(kpis.itemsPrev24h)}
          </span>
        </button>
      </Kpi>

      <Kpi label="Low confidence">
        <button
          type="button"
          className={numberButton}
          aria-label={`Low confidence: ${kpis.lowConfPct}%`}
          onClick={() => onOpen({ confidence: 'low' })}
        >
          {kpis.lowConfPct}%
        </button>
      </Kpi>

      <Kpi label="Suspected coordinated">
        {/* Whole-brief slice; opens the drawer filtered to suspected coordinated posts (06-02). */}
        <CoordinationCount
          n={kpis.suspectedCoordinated}
          slice={{ window: '24h' }}
          onOpen={onOpen}
          label="Suspected coordinated in 24h"
          className="w-fit text-left text-2xl font-semibold"
        />
      </Kpi>
    </section>
  )
}
