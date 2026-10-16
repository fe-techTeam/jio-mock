// Author privacy rule: a handle or display name leaves the server only for media outlets and
// public figures. Everyone else is a platform label ('Reddit user').
import { VISIBLE_AUTHOR_KINDS, type EvidenceAuthor, type SourceKey } from '@jio/core'

const LABELS: Record<SourceKey, string> = {
  x_api: 'X user',
  x_apify: 'X user',
  youtube: 'YouTube user',
  reddit: 'Reddit user',
  news_rss: 'News source',
  web_search: 'Web result',
  apify_instagram: 'Instagram user',
  apify_linkedin: 'LinkedIn user',
  portal_chittorgarh: 'IPO portal',
  portal_investorgain: 'IPO portal',
  portal_ipowatch: 'IPO portal',
}

export function authorLabel(sourceKey: SourceKey): string {
  return LABELS[sourceKey] ?? 'User'
}

export type AuthorRow = {
  kind: string | null
  handle: string | null
  displayName: string | null
}

function isVisibleKind(kind: string | null): kind is (typeof VISIBLE_AUTHOR_KINDS)[number] {
  return (VISIBLE_AUTHOR_KINDS as readonly (string | null)[]).includes(kind)
}

export function toEvidenceAuthor(row: AuthorRow | null, sourceKey: SourceKey): EvidenceAuthor {
  if (row && isVisibleKind(row.kind)) {
    return {
      visible: true,
      kind: row.kind,
      displayName: row.displayName ?? null,
      handle: row.handle ?? null,
    }
  }
  return { visible: false, label: authorLabel(sourceKey) }
}
