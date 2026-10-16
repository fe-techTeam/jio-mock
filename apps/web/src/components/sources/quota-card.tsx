import type { QuotaCard as Quota } from '@/app/api/sources/_lib/contract'
import { formatIst } from '@/components/shell/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function quotaText(q: Quota): string {
  return q.unitsUsedToday == null
    ? 'YouTube units used today: Not reported'
    : `YouTube units used today: ${q.unitsUsedToday.toLocaleString('en-US')} / ${q.limit.toLocaleString('en-US')}`
}

export function QuotaCard({ quota }: { quota: Quota }) {
  const pct =
    quota.unitsUsedToday == null ? 0 : Math.min(100, (quota.unitsUsedToday / quota.limit) * 100)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">YouTube quota</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p>{quotaText(quota)}</p>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={quota.limit}
          aria-valuenow={quota.unitsUsedToday ?? undefined}
          aria-label="YouTube quota used"
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">
          Resets {formatIst(quota.resetsAt, 'datetime').replace(' ', ', ')} IST (Pacific midnight)
        </p>
      </CardContent>
    </Card>
  )
}
