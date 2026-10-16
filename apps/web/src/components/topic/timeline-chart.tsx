'use client'

import { SENTIMENT_COLORS } from '@/components/brief/sentiment-colors'
import type { MarketSeries, TimelineResponse } from '@jio/core'
import { useMemo, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'
import { useOpenEvidence } from '@/components/evidence/use-open-evidence'
import { formatAge, formatCount } from '@/components/shell/format'
import { Badge } from '@/components/ui/badge'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { EvidenceSliceInput } from '@/components/evidence/slice'
import { bucketSlice, marketLatest, toChartRows, type ChartRow } from './chart-data'

export const MARKET_OPTIONS: { key: MarketSeries; label: string; short: string }[] = [
  { key: 'gmp_inr', label: 'GMP (INR)', short: 'GMP' },
  { key: 'sub_total_x', label: 'Total subscription (x)', short: 'Total x' },
  { key: 'sub_retail_x', label: 'Retail subscription (x)', short: 'Retail x' },
  { key: 'sub_nii_x', label: 'NII subscription (x)', short: 'NII x' },
  { key: 'sub_qib_x', label: 'QIB subscription (x)', short: 'QIB x' },
]

const SENTIMENT_COLORS_BY_THEME = {
  positive: { light: SENTIMENT_COLORS.light.positive, dark: SENTIMENT_COLORS.dark.positive },
  neutral: { light: SENTIMENT_COLORS.light.neutral, dark: SENTIMENT_COLORS.dark.neutral },
  negative: { light: SENTIMENT_COLORS.light.negative, dark: SENTIMENT_COLORS.dark.negative },
}

const config = {
  pos: { label: 'Positive', theme: SENTIMENT_COLORS_BY_THEME.positive },
  neu: { label: 'Neutral', theme: SENTIMENT_COLORS_BY_THEME.neutral },
  neg: { label: 'Negative', theme: SENTIMENT_COLORS_BY_THEME.negative },
  market: { label: 'Market', color: '#2563eb' },
} satisfies ChartConfig

type BarClick = { payload?: ChartRow } | ChartRow | undefined

/** Click handler for a bar: opens the one-hour evidence slice of the clicked row. */
export function makeBarClick(slug: string, open: (s: EvidenceSliceInput) => void) {
  return (data: BarClick) => {
    const row = data && 'payload' in data && data.payload ? data.payload : (data as ChartRow)
    if (row && typeof row.hourStart === 'string') open(bucketSlice(slug, row.hourStart))
  }
}

export function TimelineChart({ slug, data }: { slug: string; data: TimelineResponse }) {
  const open = useOpenEvidence()
  const [key, setKey] = useState<MarketSeries>('gmp_inr')
  const opt = MARKET_OPTIONS.find((o) => o.key === key) ?? MARKET_OPTIONS[0]!
  const rows = useMemo(() => toChartRows(data.series, data.market, key), [data, key])
  const total7d = useMemo(() => rows.reduce((a, r) => a + r.items, 0), [rows])
  const ticks = useMemo(
    () => rows.filter((r) => r.label.startsWith('00:00')).map((r) => r.hourStart),
    [rows],
  )
  const dayLabel = (hourStart: string) =>
    rows.find((r) => r.hourStart === hourStart)?.label.slice(6) ?? ''
  const latest = marketLatest(data.market, key)
  const onBar = makeBarClick(slug, open)
  const ageMin = latest
    ? Math.max(0, (Date.parse(data.asOf) - Date.parse(latest.t)) / 60_000)
    : null

  return (
    <section aria-labelledby="timeline-h" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="timeline-h" className="text-sm font-semibold">
          Last 7 days, hourly (IST)
        </h2>
        <Select value={key} onValueChange={(v) => setKey(v as MarketSeries)}>
          <SelectTrigger size="sm" aria-label="Market series" className="w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MARKET_OPTIONS.map((o) => (
              <SelectItem key={o.key} value={o.key}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ChartContainer
        config={config}
        className="aspect-auto h-[280px] w-full"
        role="img"
        aria-label={`Hourly sentiment for the last 7 days: ${formatCount(total7d)} items in total, with ${opt.short} on the right axis`}
      >
        <ComposedChart data={rows} margin={{ left: 0, right: 0, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="hourStart"
            ticks={ticks}
            tickFormatter={dayLabel}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            yAxisId="left"
            width={40}
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            label={{ value: 'Items per hour', angle: -90, position: 'insideLeft', offset: 10 }}
          />
          <YAxis
            yAxisId="market"
            orientation="right"
            width={44}
            tickLine={false}
            axisLine={false}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) =>
                  (payload as { payload?: ChartRow }[] | undefined)?.[0]?.payload?.label ?? ''
                }
              />
            }
          />
          <Bar
            yAxisId="left"
            dataKey="pos"
            stackId="sent"
            fill="var(--color-pos)"
            className="cursor-pointer"
            onClick={onBar}
            isAnimationActive={false}
          />
          <Bar
            yAxisId="left"
            dataKey="neu"
            stackId="sent"
            fill="var(--color-neu)"
            className="cursor-pointer"
            onClick={onBar}
            isAnimationActive={false}
          />
          <Bar
            yAxisId="left"
            dataKey="neg"
            stackId="sent"
            fill="var(--color-neg)"
            className="cursor-pointer"
            onClick={onBar}
            isAnimationActive={false}
          />
          <Line
            yAxisId="market"
            dataKey="market"
            name={opt.short}
            type="monotone"
            stroke="var(--color-market)"
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </ComposedChart>
      </ChartContainer>
      <div className="text-xs">
        {latest && ageMin !== null ? (
          <Badge variant="outline">
            {opt.short} {formatAge(ageMin)} old - unofficial
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            No market data
          </Badge>
        )}
      </div>
    </section>
  )
}
