// Apify Instagram hashtag adapter (02-02): a capped sample, labelled sampled by config.
import { z } from 'zod'
import type { FetchContext, FetchResult, NormalizedPost, SourceAdapter } from '@jio/core'
import { NotConfiguredError } from '../breaker'
import { fixtureFetch } from './_fixture'
import { defaultApifyFactory, runApifyActor, type ApifyFactory } from './x-apify'

// Unverified offline: confirm the actor id and its output fields on the first live run.
export const INSTAGRAM_ACTOR = 'apify/instagram-hashtag-scraper'
export const MAX_ITEMS_PER_RUN = 100
const MAX_HASHTAGS = 8
const RESULTS_LIMIT = 50

const idLike = z.union([z.string(), z.number()]).transform(String)
const num = z.number().optional()

const Item = z
  .object({
    shortCode: z.string().min(1),
    caption: z.string().nullish(),
    hashtags: z.array(z.string()).nullish(),
    timestamp: z.union([z.string(), z.number()]),
    ownerId: idLike.optional(),
    ownerUsername: z.string().optional(),
    likesCount: num,
    commentsCount: num,
    videoViewCount: num,
  })
  .passthrough()

function mapItem(raw: unknown): NormalizedPost | null {
  const parsed = Item.safeParse(raw)
  if (!parsed.success) return null
  const it = parsed.data
  const publishedAt = new Date(it.timestamp)
  const caption = it.caption?.trim() ?? ''
  const extra = (it.hashtags ?? [])
    .map((h) => `#${h.replace(/^#/, '')}`)
    .filter((h) => !caption.includes(h))
  const text = [caption, ...extra].filter(Boolean).join(' ')
  if (!text || Number.isNaN(publishedAt.getTime())) return null
  const reachRaw: Record<string, number> = {}
  if (typeof it.likesCount === 'number') reachRaw.likes = it.likesCount
  if (typeof it.commentsCount === 'number') reachRaw.comments = it.commentsCount
  if (typeof it.videoViewCount === 'number') reachRaw.views = it.videoViewCount
  const platformUserId = it.ownerId ?? it.ownerUsername
  return {
    sourceKey: 'apify_instagram',
    externalId: it.shortCode,
    url: `https://www.instagram.com/p/${it.shortCode}/`,
    // Instagram authors are never attributed by handle: kind stays 'other'.
    author: platformUserId
      ? { platform: 'instagram', platformUserId, handle: it.ownerUsername, kind: 'other' }
      : null,
    text,
    publishedAt,
    reachRaw,
    rawJson: { actor: INSTAGRAM_ACTOR, sampled: true, item: raw },
  }
}

export interface ApifyInstagramDeps {
  apify?: ApifyFactory
}

export function createApifyInstagramAdapter(deps: ApifyInstagramDeps = {}): SourceAdapter {
  return {
    key: 'apify_instagram',
    lane: 'social',
    requiredCreds: ['APIFY_TOKEN'],
    async fetch(ctx: FetchContext): Promise<FetchResult> {
      if (ctx.mode === 'fixture') return fixtureFetch('apify_instagram', ctx)
      const token = ctx.creds.APIFY_TOKEN
      if (!token) {
        throw new NotConfiguredError('APIFY_TOKEN missing: live mode not built without credentials')
      }
      const client = (deps.apify ?? defaultApifyFactory)(token)
      // Jio-specific hashtags only: generic tags (#IPO, #GMP) flood the sample.
      const hashtags = [...new Set(ctx.terms.hashtags.map((h) => h.replace(/^#/, '')))].slice(
        0,
        MAX_HASHTAGS,
      )
      const { items, costUsd } = await runApifyActor(client, {
        actorId: INSTAGRAM_ACTOR,
        input: { hashtags, resultsType: 'posts', resultsLimit: RESULTS_LIMIT },
        maxItems: MAX_ITEMS_PER_RUN,
        signal: ctx.signal,
      })
      const posts: NormalizedPost[] = []
      for (const item of items) {
        const post = mapItem(item)
        if (post && post.publishedAt >= ctx.since) posts.push(post)
        if (posts.length >= MAX_ITEMS_PER_RUN) break
      }
      return { posts, costUsd }
    },
  }
}

export default createApifyInstagramAdapter()
