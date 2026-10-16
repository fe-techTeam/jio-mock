import type { Trend } from '@jio/core'
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDeltaPct } from '@/components/shell/format'

/** Volume change against the prior 24h. Volume, not sentiment, so no green/red. */
export function TrendArrow({ trend, deltaPct }: { trend: Trend; deltaPct: number | null }) {
  if (trend === 'new') {
    return (
      <Badge variant="secondary" title="No items in the prior 24h">
        New
      </Badge>
    )
  }
  const Icon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : ArrowRight
  const text = deltaPct === null ? '0%' : formatDeltaPct(deltaPct)
  return (
    <span
      className="inline-flex items-center gap-0.5 text-xs text-muted-foreground tabular-nums"
      title={`Volume ${trend} ${text} vs prior 24h`}
    >
      <Icon className="size-3.5" aria-hidden />
      {trend === 'up' || trend === 'down' ? <span className="sr-only">{trend}</span> : null}
      <span>{text}</span>
    </span>
  )
}
