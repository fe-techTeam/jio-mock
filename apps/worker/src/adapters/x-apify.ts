// Apify X fallback adapter and the shared Apify actor runner (02-02). Instagram and LinkedIn
// import runApifyActor from here. Tests inject a fake ApifyLike; the default factory builds the
// real apify-client lazily, so fixture mode and tests never construct it.
import { ApifyClient } from 'apify-client'
import { z } from 'zod'
import type {
  FetchContext,
  FetchResult,
  NormalizedAuthor,
  NormalizedPost,
  SourceAdapter,
} from '@jio/core'
import { NotConfiguredError } from '../breaker'
import { fixtureFetch } from './_fixture'
import { buildXQueries, xAuthorKind, xPostUrl } from './x-api'

export const X_APIFY_ACTOR = 'apidojo/tweet-scraper'

// ---------------------------------------------------------------------------------------------
// Apify runner

export interface ApifyRunInfo {
  id: string
  status: string
  defaultDatasetId?: string
  usageTotalUsd?: number
}

/** The minimal subset of apify-client v2 that the adapters use. */
export interface ApifyLike {
  actor(id: string): { start(input: unknown, opts?: object): Promise<ApifyRunInfo> }
  run(id: string): {
    waitForFinish(opts?: { waitSecs?: number }): Promise<ApifyRunInfo>
    get(): Promise<ApifyRunInfo | undefined>
    abort(): Promise<unknown>
  }
  dataset(id: string): { listItems(opts?: { limit?: number }): Promise<{ items: unknown[] }> }
}

export type ApifyFactory = (token: string) => ApifyLike

export const defaultApifyFactory: ApifyFactory = (token) =>
  new ApifyClient({ token }) as unknown as ApifyLike

const SLICE_SECS = 60
const TERMINAL_FAILURES = ['FAILED', 'ABORTED', 'TIMED-OUT']

/**
 * Starts an actor, waits for it in 60 s slices (so the AbortSignal is honoured), and returns the
 * dataset items with the run's real cost. A signal abort aborts the Apify run and rejects.
 */
export async function runApifyActor(
  client: ApifyLike,
  opts: {
    actorId: string
    input: unknown
    maxItems: number
    signal: AbortSignal
    waitSecs?: number
  },
): Promise<{ items: unknown[]; costUsd: number; runId: string }> {
  const { actorId, signal } = opts
  signal.throwIfAborted()
  const started = await client.actor(actorId).start(opts.input)
  const handle = client.run(started.id)

  let onAbort: () => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  aborted.catch(() => {})
  const abortRun = () => handle.abort().catch(() => {})

  try {
    const slices = Math.max(1, Math.ceil((opts.waitSecs ?? 540) / SLICE_SECS))
    let finished: ApifyRunInfo | undefined
    for (let i = 0; i < slices && !finished; i++) {
      const run = await Promise.race([handle.waitForFinish({ waitSecs: SLICE_SECS }), aborted])
      if (run.status === 'SUCCEEDED' || TERMINAL_FAILURES.includes(run.status)) finished = run
    }
    if (!finished) {
      await abortRun()
      throw new Error(`apify run did not finish within ${opts.waitSecs ?? 540}s: ${actorId}`)
    }
    if (finished.status !== 'SUCCEEDED') {
      throw new Error(`apify run ${finished.status}: ${actorId}`)
    }
    let usage = finished.usageTotalUsd
    if (usage === undefined) usage = (await handle.get())?.usageTotalUsd
    const datasetId = finished.defaultDatasetId ?? started.defaultDatasetId
    if (!datasetId) throw new Error(`apify run has no dataset: ${actorId}`)
    const { items } = await client.dataset(datasetId).listItems({ limit: opts.maxItems })
    return { items, costUsd: usage ?? 0, runId: started.id }
  } catch (err) {
    if (signal.aborted) await abortRun()
    throw err
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

// ---------------------------------------------------------------------------------------------
// X actor items

const idLike = z.union([z.string(), z.number()]).transform(String)
const num = z.number().optional()

const ItemAuthor = z
  .object({
    id: idLike.optional(),
    userName: z.string().optional(),
    name: z.string().optional(),
    followers: num,
    isVerified: z.boolean().optional(),
    isBlueVerified: z.boolean().optional(),
  })
  .passthrough()

const Item = z
  .object({
    id: idLike.optional(),
    id_str: idLike.optional(),
    url: z.string().optional(),
    twitterUrl: z.string().optional(),
    text: z.string().optional(),
    fullText: z.string().optional(),
    createdAt: z.union([z.string(), z.number()]),
    author: ItemAuthor.optional(),
    likeCount: num,
    retweetCount: num,
    replyCount: num,
    quoteCount: num,
    viewCount: num,
  })
  .passthrough()

function mapItem(raw: unknown): NormalizedPost | null {
  const parsed = Item.safeParse(raw)
  if (!parsed.success) return null
  const it = parsed.data
  const id = it.id ?? it.id_str
  const text = it.text ?? it.fullText
  const publishedAt = new Date(it.createdAt)
  if (!id || !text || Number.isNaN(publishedAt.getTime())) return null

  const a = it.author
  const link = it.url ?? it.twitterUrl
  const fromLink = link?.match(/(?:twitter|x)\.com\/([^/]+)\/status\//)?.[1]
  const username = a?.userName ?? (fromLink && fromLink !== 'i' ? fromLink : undefined)
  const url = xPostUrl(username, id)
  const author: NormalizedAuthor | null =
    a && (a.id || username)
      ? {
          platform: 'x',
          platformUserId: a.id ?? username!,
          handle: username,
          displayName: a.name,
          followers: a.followers,
          kind: xAuthorKind({
            username,
            followers: a.followers,
            verified: a.isVerified === true || a.isBlueVerified === true,
          }),
        }
      : null
  const reachRaw: Record<string, number> = {}
  const put = (k: string, v: number | undefined) => {
    if (typeof v === 'number') reachRaw[k] = v
  }
  put('followers', a?.followers)
  put('likes', it.likeCount)
  put('retweets', it.retweetCount)
  put('replies', it.replyCount)
  put('quotes', it.quoteCount)
  put('impressions', it.viewCount)
  return {
    sourceKey: 'x_apify',
    externalId: id,
    url,
    author,
    text,
    publishedAt,
    reachRaw,
    rawJson: { actor: X_APIFY_ACTOR, item: raw },
  }
}

export interface XApifyDeps {
  apify?: ApifyFactory
  now?: () => Date
}

const MAX_ITEMS = 200

export function createXApifyAdapter(deps: XApifyDeps = {}): SourceAdapter {
  return {
    key: 'x_apify',
    lane: 'social',
    requiredCreds: ['APIFY_TOKEN'],
    async fetch(ctx: FetchContext): Promise<FetchResult> {
      if (ctx.mode === 'fixture') return fixtureFetch('x_apify', ctx)
      const token = ctx.creds.APIFY_TOKEN
      if (!token) {
        throw new NotConfiguredError('APIFY_TOKEN missing: live mode not built without credentials')
      }
      const client = (deps.apify ?? defaultApifyFactory)(token)
      const { items, costUsd } = await runApifyActor(client, {
        actorId: X_APIFY_ACTOR,
        input: {
          searchTerms: buildXQueries(ctx.terms, { maxLen: 512 }),
          sort: 'Latest',
          maxItems: MAX_ITEMS,
          start: ctx.since.toISOString().slice(0, 10),
        },
        maxItems: MAX_ITEMS,
        signal: ctx.signal,
      })
      let invalid = 0
      const posts: NormalizedPost[] = []
      for (const item of items) {
        const post = mapItem(item)
        if (!post) invalid++
        else if (post.publishedAt >= ctx.since) posts.push(post)
      }
      const first = posts[0]
      if (first) first.rawJson = { ...(first.rawJson as object), dropped: { invalid } }
      return { posts, costUsd }
    },
  }
}

export default createXApifyAdapter()
