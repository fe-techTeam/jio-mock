'use client'

// Suspected coordination on the topic page (06-02): near-duplicate clusters, burst buckets and
// the top-5 author share. Everything is labelled "suspected"; authors appear only as counts.
import type { CoordinationBurst, CoordinationCluster, TimelineCoordination } from '@jio/core'
import { COORDINATION_HELP } from '@/components/brief/coordination-count'
import { useOpenEvidence } from '@/components/evidence/use-open-evidence'
import { formatIst } from '@/components/shell/format'

export const EMPTY_TEXT = 'No suspected coordination in the last 7 days'

export const panelTitles = [
  'Suspected near-duplicate clusters',
  'Suspected bursts',
  'Top-5 author share (suspected)',
] as const

/** '09:30 16 Oct' (IST). */
export function formatBucketIst(iso: string): string {
  return formatIst(iso, 'datetime')
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** '6 posts from 5 distinct accounts, 09:30 16 Oct to 10:10 16 Oct'. */
export function clusterLabel(c: CoordinationCluster): string {
  const span =
    c.firstAt === c.lastAt
      ? formatBucketIst(c.firstAt)
      : `${formatBucketIst(c.firstAt)} to ${formatBucketIst(c.lastAt)}`
  return `${plural(c.posts, 'post', 'posts')} from ${plural(c.authors, 'distinct account', 'distinct accounts')}, ${span}`
}

/** '15 items vs median 2'. */
export function burstLabel(b: CoordinationBurst): string {
  const median = Number.isInteger(b.trailingMedian)
    ? String(b.trailingMedian)
    : b.trailingMedian.toFixed(1)
  return `${b.items} items vs median ${median}`
}

export function top5Label(share: number | null): string {
  if (share == null) return 'Not enough posts in the last 24h (under 30)'
  return `Top-5 authors posted ${Math.round(share * 100)}% of the last 24h (suspected)`
}

const rowButton =
  'flex w-full flex-col gap-1 rounded-md border p-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring'

export function CoordinationPanel({
  slug,
  topicName,
  data,
}: {
  slug: string
  topicName: string
  data: TimelineCoordination | undefined
}) {
  const open = useOpenEvidence()
  const coord = data ?? { clusters: [], bursts: [], top5AuthorShare: null }
  const empty =
    coord.clusters.length === 0 && coord.bursts.length === 0 && coord.top5AuthorShare == null
  const base = { topic: slug, topicName, window: '7d' as const }

  return (
    <section
      aria-labelledby="coordination-title"
      className="flex flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="coordination-title" className="text-base font-semibold">
          Suspected coordination
        </h2>
        <p className="text-xs text-muted-foreground">{COORDINATION_HELP}</p>
      </div>

      {empty ? (
        <p className="text-sm text-muted-foreground">{EMPTY_TEXT}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="text-sm font-medium">{panelTitles[0]}</h3>
            {coord.clusters.length === 0 ? (
              <p className="text-xs text-muted-foreground">None in the last 7 days</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {coord.clusters.map((c) => (
                  <li key={c.clusterId}>
                    <button
                      type="button"
                      className={rowButton}
                      onClick={() => open({ ...base, cluster: c.clusterId, coordinated: true })}
                    >
                      <span className="line-clamp-2 break-words">{c.sample || '(no text)'}</span>
                      <span className="text-xs text-muted-foreground">{clusterLabel(c)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="text-sm font-medium">{panelTitles[1]}</h3>
            {coord.bursts.length === 0 ? (
              <p className="text-xs text-muted-foreground">None in the last 7 days</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {coord.bursts.map((b) => (
                  <li key={b.bucketStart}>
                    <button
                      type="button"
                      className={rowButton}
                      onClick={() => open({ ...base, bucket: b.bucketStart })}
                    >
                      <span className="font-medium tabular-nums">
                        {formatBucketIst(b.bucketStart)} IST
                      </span>
                      <span className="text-xs text-muted-foreground">{burstLabel(b)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="text-sm font-medium">{panelTitles[2]}</h3>
            <p className="text-sm tabular-nums">{top5Label(coord.top5AuthorShare)}</p>
          </div>
        </div>
      )}
    </section>
  )
}
