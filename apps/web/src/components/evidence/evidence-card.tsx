import type { EvidenceAuthor, EvidenceItem } from '@jio/core'
import { ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatIst, safeExternalUrl } from '@/components/shell/format'
import { RelabelControls } from './relabel'
import { SourceBadge } from './source-badge'

function authorText(a: EvidenceAuthor): string {
  if (!a.visible) return a.label
  if (a.displayName && a.handle) return `${a.displayName} (@${a.handle})`
  return a.displayName ?? (a.handle ? `@${a.handle}` : 'Unnamed')
}

function reachText(score: number | null): string {
  if (score === null || !Number.isFinite(score)) return 'Reach -'
  return `Reach ${Math.round(Math.min(100, Math.max(0, score)))}`
}

/**
 * One post behind a number. Scraped text is untrusted: it is rendered as plain text only.
 * Author names appear only when the API marks the author visible (media outlets, public figures).
 */
export function EvidenceCard({ item }: { item: EvidenceItem }) {
  const href = safeExternalUrl(item.url)
  return (
    <article className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <SourceBadge sourceKey={item.sourceKey} />
        <time dateTime={item.publishedAt}>{formatIst(item.publishedAt, 'datetime')} IST</time>
        <span>{reachText(item.reachScore)}</span>
        {item.confidence === 'low' ? (
          <Badge
            variant="outline"
            className="border-amber-500/50 text-amber-800 dark:text-amber-300"
          >
            Low confidence
          </Badge>
        ) : null}
      </div>
      <p className="break-words whitespace-pre-wrap">{item.text}</p>
      {item.lang !== 'en' && item.glossEn ? (
        <p className="text-xs text-muted-foreground">EN: {item.glossEn}</p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{authorText(item.author)}</span>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
          >
            Open original
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : null}
      </div>
      <RelabelControls item={item} />
    </article>
  )
}
