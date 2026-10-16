// Apify LinkedIn post-search adapter (02-02): a capped sample, labelled sampled by config.
import { z } from 'zod'
import type { FetchContext, FetchResult, NormalizedPost, SourceAdapter } from '@jio/core'
import { NotConfiguredError } from '../breaker'
import { fixtureFetch } from './_fixture'
import { defaultApifyFactory, runApifyActor, type ApifyFactory } from './x-apify'

// Unverified offline: confirm the actor id and its output fields on the first live run.
export const LINKEDIN_ACTOR = 'harvestapi/linkedin-post-search'
export const MAX_ITEMS_PER_RUN = 100
const MAX_POSTS = 50
const DAY_MS = 86_400_000

export const LINKEDIN_QUERIES = [
  '"Jio IPO"',
  '"Jio Platforms IPO"',
  '"Reliance Jio IPO"',
  '"Mukesh Ambani" IPO',
  '"Akash Ambani" Jio',
  '"Isha Ambani" Jio',
]

const MEDIA_NAME =
  /economic times|mint|moneycontrol|business standard|financial express|cnbc|ndtv profit|groww|emkay|centrum/i

const num = z.number().optional()
const dateLike = z.union([z.string(), z.number()])

const Item = z
  .object({
    id: z.string().optional(),
    urn: z.string().optional(),
    url: z.string().optional(),
    postUrl: z.string().optional(),
    linkedinUrl: z.string().optional(),
    text: z.string().optional(),
    content: z.string().optional(),
    commentary: z.string().optional(),
    postedAt: z.union([dateLike, z.object({ date: dateLike }).passthrough()]),
    author: z
      .object({
        name: z.string().optional(),
        publicIdentifier: z.string().optional(),
        universalName: z.string().optional(),
        type: z.string().optional(),
        followersCount: num,
      })
      .passthrough()
      .optional(),
    likes: num,
    numLikes: num,
    comments: num,
    numComments: num,
    shares: num,
    numShares: num,
  })
  .passthrough()

function mapItem(raw: unknown): NormalizedPost | null {
  const parsed = Item.safeParse(raw)
  if (!parsed.success) return null
  const it = parsed.data
  const id = it.id ?? it.urn
  const url = it.url ?? it.postUrl ?? it.linkedinUrl
  const text = it.text ?? it.content ?? it.commentary
  const when = typeof it.postedAt === 'object' ? it.postedAt.date : it.postedAt
  const publishedAt = new Date(when)
  if (!id || !url || !text || Number.isNaN(publishedAt.getTime())) return null

  const a = it.author
  const handle = a?.publicIdentifier ?? a?.universalName
  const platformUserId = handle ?? a?.name
  const isMedia = a?.type?.toLowerCase() === 'company' && MEDIA_NAME.test(a.name ?? '')
  const reachRaw: Record<string, number> = {}
  const put = (k: string, v: number | undefined) => {
    if (typeof v === 'number') reachRaw[k] = v
  }
  put('likes', it.likes ?? it.numLikes)
  put('comments', it.comments ?? it.numComments)
  put('shares', it.shares ?? it.numShares)
  put('followers', a?.followersCount)
  return {
    sourceKey: 'apify_linkedin',
    externalId: id,
    url,
    author: platformUserId
      ? {
          platform: 'linkedin',
          platformUserId,
          handle,
          displayName: a?.name,
          followers: a?.followersCount,
          kind: isMedia ? 'media_outlet' : 'other',
        }
      : null,
    text,
    publishedAt,
    reachRaw,
    rawJson: { actor: LINKEDIN_ACTOR, sampled: true, item: raw },
  }
}

export interface ApifyLinkedinDeps {
  apify?: ApifyFactory
  now?: () => Date
}

export function createApifyLinkedinAdapter(deps: ApifyLinkedinDeps = {}): SourceAdapter {
  return {
    key: 'apify_linkedin',
    lane: 'social',
    requiredCreds: ['APIFY_TOKEN'],
    async fetch(ctx: FetchContext): Promise<FetchResult> {
      if (ctx.mode === 'fixture') return fixtureFetch('apify_linkedin', ctx)
      const token = ctx.creds.APIFY_TOKEN
      if (!token) {
        throw new NotConfiguredError('APIFY_TOKEN missing: live mode not built without credentials')
      }
      const now = (deps.now ?? (() => new Date()))()
      const client = (deps.apify ?? defaultApifyFactory)(token)
      const { items, costUsd } = await runApifyActor(client, {
        actorId: LINKEDIN_ACTOR,
        input: {
          searchQueries: LINKEDIN_QUERIES,
          maxPosts: MAX_POSTS,
          postedLimit: now.getTime() - ctx.since.getTime() <= DAY_MS ? '24h' : 'week',
        },
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

export default createApifyLinkedinAdapter()
