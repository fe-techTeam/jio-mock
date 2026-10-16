import { sql } from 'drizzle-orm'
import {
  AUTHOR_KINDS,
  LANES,
  SOURCE_DEFAULT_LANE,
  SOURCE_KEYS,
  type AuthorKind,
  type Lane,
  type NormalizedPost,
  type SourceKey,
} from '@jio/core'
import { authors, posts } from '../schema'
import type { DbLike } from './events'

export type UpsertPostsOptions = {
  isFixture: boolean
  /** Used when a post carries no lane of its own; else SOURCE_DEFAULT_LANE. */
  lane?: Lane
  /** authors.delete_after = now + this many days (default 90). */
  authorRetentionDays?: number
  now?: Date
}

export type UpsertPostsResult = {
  inserted: number
  /** Already stored, or repeated inside the batch. */
  duplicates: number
  /** Invalid rows (bad source key, empty external id, invalid date ...), skipped. */
  rejected: number
  insertedIds: string[]
}

const CHUNK = 500
const DAY_MS = 86_400_000
const INT32_MAX = 2_147_483_647
const SOURCE_SET: ReadonlySet<string> = new Set(SOURCE_KEYS)
const LANE_SET: ReadonlySet<string> = new Set(LANES)
const AUTHOR_KIND_SET: ReadonlySet<string> = new Set(AUTHOR_KINDS)

const stripNul = (s: string) => s.replaceAll('\u0000', '')
const optText = (s: unknown) => (typeof s === 'string' && s.length > 0 ? stripNul(s) : null)

/** JSON round-trip that drops escaped U+0000 (Postgres jsonb rejects it) but keeps a literal "\\u0000". */
export function stripNulJson(value: unknown): unknown {
  if (value === undefined) return null
  const json = JSON.stringify(value)
  if (json === undefined) return null
  return JSON.parse(json.replace(/(?<!\\)((?:\\\\)*)\\u0000/g, '$1'))
}

function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime())
}

function cleanReach(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[stripNul(k)] = v
    }
  }
  return out
}

type AuthorRow = {
  platform: string
  platformUserId: string
  handle: string | null
  displayName: string | null
  followers: number | null
  kind: AuthorKind
}

const authorKey = (platform: string, platformUserId: string) => `${platform}\u0001${platformUserId}`

function cleanAuthor(a: NormalizedPost['author']): AuthorRow | null {
  if (!a || typeof a !== 'object') return null
  const platform = optText(a.platform)
  const platformUserId = optText(a.platformUserId)
  if (!platform || !platformUserId) return null
  const followers =
    typeof a.followers === 'number' && Number.isFinite(a.followers) && a.followers >= 0
      ? Math.min(Math.round(a.followers), INT32_MAX)
      : null
  return {
    platform,
    platformUserId,
    handle: optText(a.handle),
    displayName: optText(a.displayName),
    followers,
    kind: a.kind && AUTHOR_KIND_SET.has(a.kind) ? a.kind : 'other',
  }
}

/** Later sightings in the same batch win, except that 'other' never replaces a specific kind. */
function mergeAuthor(prev: AuthorRow, next: AuthorRow): AuthorRow {
  return {
    ...prev,
    handle: next.handle ?? prev.handle,
    displayName: next.displayName ?? prev.displayName,
    followers: next.followers ?? prev.followers,
    kind: next.kind !== 'other' ? next.kind : prev.kind,
  }
}

type PostRow = {
  sourceKey: SourceKey
  externalId: string
  url: string
  lane: Lane
  text: string
  publishedAt: Date
  reachRaw: Record<string, number>
  rawJson: unknown
  isFixture: boolean
  author: AuthorRow | null
}

function chunks<T>(xs: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

/**
 * Inserts new posts, deduped on (source_key, external_id), and upserts their authors (one row per
 * platform + platformUserId, so x_api and x_apify share X authors). Never throws on a bad row: it
 * counts it as rejected. Existing posts are not updated. Lane: post.lane, then opts.lane, then
 * SOURCE_DEFAULT_LANE. Triage columns (lang, content_hash, matched_terms, embedding) stay empty.
 */
export async function upsertPosts(
  db: DbLike,
  input: NormalizedPost[],
  opts: UpsertPostsOptions,
): Promise<UpsertPostsResult> {
  const result: UpsertPostsResult = { inserted: 0, duplicates: 0, rejected: 0, insertedIds: [] }
  if (input.length === 0) return result

  const now = opts.now ?? new Date()
  const deleteAfter = new Date(now.getTime() + (opts.authorRetentionDays ?? 90) * DAY_MS)

  const rows = new Map<string, PostRow>()
  for (const p of input) {
    const externalId = typeof p?.externalId === 'string' ? stripNul(p.externalId).trim() : ''
    if (
      !SOURCE_SET.has(p?.sourceKey) ||
      externalId === '' ||
      typeof p.url !== 'string' ||
      typeof p.text !== 'string' ||
      !isValidDate(p.publishedAt)
    ) {
      result.rejected += 1
      continue
    }
    const key = `${p.sourceKey}\u0001${externalId}`
    if (rows.has(key)) {
      result.duplicates += 1
      continue
    }
    const lane =
      p.lane && LANE_SET.has(p.lane) ? p.lane : (opts.lane ?? SOURCE_DEFAULT_LANE[p.sourceKey])
    let rawJson: unknown
    try {
      rawJson = stripNulJson(p.rawJson)
    } catch {
      rawJson = null // circular or otherwise unserialisable: keep the post, drop the raw payload
    }
    rows.set(key, {
      sourceKey: p.sourceKey,
      externalId,
      url: stripNul(p.url),
      lane,
      text: stripNul(p.text),
      publishedAt: p.publishedAt,
      reachRaw: cleanReach(p.reachRaw),
      rawJson,
      isFixture: opts.isFixture,
      author: cleanAuthor(p.author),
    })
  }
  if (rows.size === 0) return result

  const batchAuthors = new Map<string, AuthorRow>()
  for (const r of rows.values()) {
    if (!r.author) continue
    const k = authorKey(r.author.platform, r.author.platformUserId)
    const prev = batchAuthors.get(k)
    batchAuthors.set(k, prev ? mergeAuthor(prev, r.author) : r.author)
  }

  return db.transaction(async (tx) => {
    const authorIds = new Map<string, string>()
    // A stable key order keeps concurrent fetchers (x_api, x_apify) from deadlocking on authors.
    const sortedAuthors = [...batchAuthors.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, a]) => a)
    for (const chunk of chunks(sortedAuthors, CHUNK)) {
      const upserted = await tx
        .insert(authors)
        .values(
          chunk.map((a) => ({
            ...a,
            firstSeenAt: now,
            lastSeenAt: now,
            deleteAfter,
          })),
        )
        .onConflictDoUpdate({
          target: [authors.platform, authors.platformUserId],
          set: {
            handle: sql`coalesce(excluded.handle, ${authors.handle})`,
            displayName: sql`coalesce(excluded.display_name, ${authors.displayName})`,
            followers: sql`coalesce(excluded.followers, ${authors.followers})`,
            kind: sql`case when excluded.kind <> 'other' then excluded.kind else ${authors.kind} end`,
            lastSeenAt: sql`greatest(excluded.last_seen_at, ${authors.lastSeenAt})`,
            deleteAfter: sql`greatest(excluded.delete_after, ${authors.deleteAfter})`,
          },
        })
        .returning({
          id: authors.id,
          platform: authors.platform,
          platformUserId: authors.platformUserId,
        })
      for (const a of upserted) authorIds.set(authorKey(a.platform, a.platformUserId), a.id)
    }

    for (const chunk of chunks([...rows.values()], CHUNK)) {
      const inserted = await tx
        .insert(posts)
        .values(
          chunk.map(({ author, ...r }) => ({
            ...r,
            authorId: author
              ? (authorIds.get(authorKey(author.platform, author.platformUserId)) ?? null)
              : null,
          })),
        )
        .onConflictDoNothing({ target: [posts.sourceKey, posts.externalId] })
        .returning({ id: posts.id })
      for (const r of inserted) result.insertedIds.push(r.id)
    }

    result.inserted = result.insertedIds.length
    result.duplicates += rows.size - result.inserted
    return result
  })
}
