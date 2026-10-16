// Fixture support shared by every adapter: fixture files, the fixture-only stub factory and a fake
// fetch for tests. Fixture posts are dated relative to "now" so they always fall inside the 7-day
// window, and their external ids carry an `fx-` prefix so they never collide with live ids.
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import {
  AUTHOR_KINDS,
  SOURCE_KEYS,
  type FetchContext,
  type FetchResult,
  type Lane,
  type NormalizedPost,
  type SourceAdapter,
  type SourceKey,
} from '@jio/core'
import { NotConfiguredError } from '../breaker'

const FIXTURES_DIR = new URL('../../fixtures/', import.meta.url)

/** Minutes in 7 days, exclusive: every fixture post is inside the backfill window. */
const MAX_MINUTES_AGO = 7 * 24 * 60 - 1

const FixtureAuthor = z.object({
  platform: z.string().min(1),
  platformUserId: z.string().min(1),
  handle: z.string().optional(),
  displayName: z.string().optional(),
  followers: z.number().int().nonnegative().optional(),
  kind: z.enum(AUTHOR_KINDS).optional(),
})

export const FixturePost = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  minutesAgo: z.number().int().min(0).max(MAX_MINUTES_AGO),
  text: z.string().min(1),
  /** Test-only: the language the item is written in. */
  lang: z.enum(['en', 'hinglish', 'hi', 'gu']),
  /** Test-only: whether the @jio/core keyword matcher must accept the item. */
  expectRelevant: z.boolean().default(true),
  /** Test-only: the matcher is known to get this item wrong (logged as an issue). */
  knownMatcherGap: z.boolean().optional(),
  /** Test-only: the seed topic slug the item was written for. */
  topic: z.string().optional(),
  /** Source-specific extras (YouTube video/comment, subreddit); kept in rawJson. */
  meta: z.record(z.string(), z.unknown()).optional(),
  author: FixtureAuthor.nullable(),
  reachRaw: z.record(z.string(), z.number()).default({}),
})
export type FixturePost = z.infer<typeof FixturePost>

export const FixtureFile = z.object({
  sourceKey: z.enum(SOURCE_KEYS),
  items: z.array(FixturePost),
})
export type FixtureFile = z.infer<typeof FixtureFile>

const cache = new Map<SourceKey, FixtureFile>()

/** Parses apps/worker/fixtures/<key>.json once per process. Throws when missing or invalid. */
export function loadFixture(key: SourceKey): FixtureFile {
  const hit = cache.get(key)
  if (hit) return hit
  const raw: unknown = JSON.parse(readFileSync(new URL(`${key}.json`, FIXTURES_DIR), 'utf8'))
  const file = FixtureFile.parse(raw)
  if (file.sourceKey !== key) {
    throw new Error(`Fixture ${key}.json declares sourceKey ${file.sourceKey}`)
  }
  cache.set(key, file)
  return file
}

/** Raw text of a fixture file (portal HTML pages). */
export function readFixtureText(filename: string): string {
  if (filename.includes('..') || filename.startsWith('/')) {
    throw new Error(`Invalid fixture filename: ${filename}`)
  }
  return readFileSync(new URL(filename, FIXTURES_DIR), 'utf8')
}

export function fixtureToPosts(file: FixtureFile, now: Date): NormalizedPost[] {
  return file.items.map((item) => ({
    sourceKey: file.sourceKey,
    externalId: `fx-${item.id}`,
    url: item.url,
    author: item.author ? { ...item.author } : null,
    text: item.text,
    publishedAt: new Date(now.getTime() - item.minutesAgo * 60_000),
    reachRaw: { ...item.reachRaw },
    rawJson: { fixture: true, ...item },
  }))
}

/** The fixture posts of `key`, dated against the current time. Free (costUsd 0). */
export async function fixtureFetch(key: SourceKey, ctx: FetchContext): Promise<FetchResult> {
  ctx.signal.throwIfAborted()
  return { posts: fixtureToPosts(loadFixture(key), new Date()), costUsd: 0 }
}

const isPortal = (key: SourceKey) => key.startsWith('portal_')

/**
 * A stub adapter: fixture mode serves the fixture file (portals serve nothing until 02-04 parses
 * their HTML); live mode rejects with NotConfiguredError until a wave-2 plan builds it.
 */
export function createFixtureOnlyAdapter(
  key: SourceKey,
  lane: Lane,
  requiredCreds: string[],
): SourceAdapter {
  return {
    key,
    lane,
    requiredCreds,
    async fetch(ctx) {
      if (ctx.mode !== 'fixture') throw new NotConfiguredError('live mode not built')
      if (isPortal(key)) return { posts: [], marketPoints: [], costUsd: 0 }
      return fixtureFetch(key, ctx)
    },
  }
}

export type FakeRoute = [RegExp, (url: string, init?: RequestInit) => Response | Promise<Response>]

/**
 * A `fetch` replacement for adapter tests: the first route whose pattern matches the URL answers;
 * any other URL rejects with `Unexpected network call: <url>`, so tests never reach the network.
 */
export function createFakeFetch(routes: FakeRoute[]): typeof fetch {
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    for (const [pattern, handler] of routes) {
      pattern.lastIndex = 0
      if (pattern.test(url)) return handler(url, init)
    }
    throw new Error(`Unexpected network call: ${url}`)
  }
  return fake as typeof fetch
}
