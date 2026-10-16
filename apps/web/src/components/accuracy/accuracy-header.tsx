import type { AccuracyResponse } from '@/app/api/accuracy/_lib/compute'
import { formatIst } from '@/components/shell/format'
import { Card, CardContent } from '@/components/ui/card'

export const pct = (x: number | null | undefined): string =>
  x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(1)}%`

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-3xl font-semibold tabular-nums">{value}</span>
    </div>
  )
}

/** Overall accuracy, or only the progress text while the gold set is below target. */
export function AccuracyHeader({ data }: { data: AccuracyResponse }) {
  return (
    <section className="flex flex-col gap-3" aria-label="Overall accuracy">
      <Card>
        <CardContent className="flex flex-wrap items-end justify-between gap-6">
          {data.measured && data.overall ? (
            <div className="flex flex-wrap gap-8">
              <Figure label="Sentiment accuracy" value={pct(data.overall.sentiment)} />
              <Figure label="Topic accuracy" value={pct(data.overall.topic)} />
            </div>
          ) : data.measured ? (
            <p className="text-lg font-medium">
              No gold post has a comparable model label yet ({data.unscored} unscored)
            </p>
          ) : (
            <p className="text-lg font-medium">
              Not measured yet: {data.labelled} of {data.target} labelled
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {data.promptVersion
              ? `Prompt ${data.promptVersion}${data.promptAt ? `, ${formatIst(data.promptAt, 'datetime')} IST` : ''}`
              : 'No model labels yet'}
          </p>
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        {data.corrections.count} dashboard relabels, {data.corrections.usedAsFewShot} used as
        few-shot examples
      </p>
    </section>
  )
}
