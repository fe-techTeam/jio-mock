import type { SourceKey } from '@jio/core'
import { Badge } from '@/components/ui/badge'

const LABELS: Record<SourceKey, string> = {
  x_api: 'X',
  x_apify: 'X (Apify)',
  youtube: 'YouTube',
  reddit: 'Reddit',
  news_rss: 'News',
  web_search: 'Web',
  apify_instagram: 'Instagram (sampled)',
  apify_linkedin: 'LinkedIn (sampled)',
  portal_chittorgarh: 'Chittorgarh',
  portal_investorgain: 'InvestorGain',
  portal_ipowatch: 'IPOWatch',
}

export function sourceLabel(key: SourceKey): string {
  return LABELS[key] ?? key
}

export function SourceBadge({ sourceKey }: { sourceKey: SourceKey }) {
  return (
    <Badge variant="outline" className="font-normal">
      {sourceLabel(sourceKey)}
    </Badge>
  )
}
