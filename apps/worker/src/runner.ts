// Fetch runner: resolves a source's mode and credentials, calls its adapter under a timeout,
// stores what came back and writes exactly one fetch_run event. runFetch never rejects.
import { createDecipheriv } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import type {
  FetchContext,
  FetchResult,
  FetchRunStatus,
  Lane,
  NormalizedMarketPoint,
  NormalizedPost,
  SourceAdapter,
  SourceConfig,
  SourceKey,
} from '@jio/core'
import {
  getLatestConfig,
  insertMarketPoints,
  logEvent,
  schema,
  upsertPosts,
  type Db,
} from '@jio/db'
import { RateLimitedError } from './breaker'
import type { ResolvedMode } from './scheduler'

export type SourcesMode = 'auto' | 'fixture' | 'live'
export type Env = Record<string, string | undefined>

/** fetch_run status values. 'rate_limited' extends FetchRunStatus (ok | error | skipped). */
export type RunStatus = 'ok' | 'error' | 'rate_limited'

export interface RunOutcome {
  sourceKey: SourceKey
  status: RunStatus
  mode: ResolvedMode['mode']
  fetched: number
  inserted: number
  duplicates: number
  marketPoints: number
  costUsd: number
  durationMs: number
  error?: string
}

export interface RunnerDeps {
  db: Db
  adapters: Record<SourceKey, SourceAdapter>
  env: Env
  now?: () => Date
  timeoutsMs?: Partial<Record<SourceKey, number>>
}

export const DEFAULT_TIMEOUT_MS = 90_000
export const APIFY_TIMEOUT_MS = 600_000
/** The next run re-reads this much before the previous run's start, to cover late-indexed posts. */
export const SINCE_OVERLAP_MS = 5 * 60_000
export const MAX_TEXT_CHARS = 8_000
const FUTURE_TOLERANCE_MS = 5 * 60_000
const DAY_MS = 86_400_000
const ENC_PREFIX = 'enc:v1:'
const FIXTURE_URL_SUFFIX = '#fixture'

export function parseSourcesMode(v: string | undefined): SourcesMode {
  return v === 'fixture' || v === 'live' ? v : 'auto'
}

export function defaultTimeoutMs(key: SourceKey): number {
  return key === 'x_apify' || key.startsWith('apify_') ? APIFY_TIMEOUT_MS : DEFAULT_TIMEOUT_MS
}

const missingCreds = (adapter: Pick<SourceAdapter, 'requiredCreds'>, creds: Env) =>
  adapter.requiredCreds.filter((name) => !creds[name])

/**
 * fixture: always fixture. live: live, or unconfigured when credentials are missing.
 * auto: live when every required credential is present (keyless sources are always live),
 * otherwise fixture.
 */
export function resolveMode(
  sourcesMode: SourcesMode,
  adapter: Pick<SourceAdapter, 'requiredCreds'>,
  creds: Env,
): ResolvedMode {
  if (sourcesMode === 'fixture') return { mode: 'fixture', reason: 'sources_mode' }
  const missing = missingCreds(adapter, creds)
  if (missing.length === 0) return { mode: 'live' }
  if (sourcesMode === 'live') return { mode: 'unconfigured', missing }
  return { mode: 'fixture', reason: 'missing_creds', missing }
}

/**
 * AES-256-GCM. key = base64 CONFIG_ENCRYPTION_KEY (32 bytes);
 * blob = "enc:v1:" + base64url(iv(12) | authTag(16) | ciphertext). Throws on any mismatch.
 */
export function decryptSecret(blob: string, keyB64: string): string {
  if (!blob.startsWith(ENC_PREFIX)) throw new Error('not an enc:v1 value')
  const key = Buffer.from(keyB64, 'base64')
  if (key.length !== 32) throw new Error('CONFIG_ENCRYPTION_KEY must decode to 32 bytes')
  const raw = Buffer.from(blob.slice(ENC_PREFIX.length), 'base64url')
  if (raw.length < 12 + 16) throw new Error('enc:v1 value too short')
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
  decipher.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
}

/**
 * The adapter's required credentials. A value saved in config (source.creds_ref, keyed by the
 * env-style name) wins over the environment. An enc:v1 value that cannot be decrypted counts as
 * missing; its value is never logged.
 */
export function resolveCreds(
  adapter: Pick<SourceAdapter, 'requiredCreds'>,
  source: Pick<SourceConfig, 'creds_ref'>,
  env: Env,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const name of adapter.requiredCreds) {
    const saved = source.creds_ref?.[name]
    if (saved) {
      if (!saved.startsWith(ENC_PREFIX)) {
        out[name] = saved
        continue
      }
      try {
        out[name] = decryptSecret(saved, env.CONFIG_ENCRYPTION_KEY ?? '') || undefined
      } catch {
        out[name] = undefined
      }
      continue
    }
    out[name] = env[name] || undefined
  }
  return out
}

/**
 * Lane per post: a lane the adapter set wins; a media outlet is media; an ordinary author or a
 * public figure found by a media-lane source (web search hits on Instagram) is social; otherwise
 * the adapter's lane.
 */
export function resolvePostLane(adapterLane: Lane, post: NormalizedPost): Lane {
  if (post.lane === 'social' || post.lane === 'media') return post.lane
  const kind = post.author?.kind
  if (kind === 'media_outlet') return 'media'
  if (adapterLane === 'media' && (kind === 'other' || kind === 'public_figure')) return 'social'
  return adapterLane
}

/**
 * Drops posts with empty text, no external id or an invalid date, clamps dates more than
 * 5 minutes in the future to now, caps text at 8,000 chars and dedupes by externalId.
 */
export function sanitizePosts(
  posts: NormalizedPost[],
  now: Date,
): { valid: NormalizedPost[]; dropped: number } {
  const valid: NormalizedPost[] = []
  const seen = new Set<string>()
  let dropped = 0
  for (const p of posts) {
    const date = p?.publishedAt
    if (
      !p ||
      typeof p.text !== 'string' ||
      p.text.trim() === '' ||
      typeof p.externalId !== 'string' ||
      p.externalId.trim() === '' ||
      !(date instanceof Date) ||
      Number.isNaN(date.getTime()) ||
      seen.has(p.externalId)
    ) {
      dropped += 1
      continue
    }
    seen.add(p.externalId)
    const publishedAt = date.getTime() > now.getTime() + FUTURE_TOLERANCE_MS ? new Date(now) : date
    const text = p.text.length > MAX_TEXT_CHARS ? p.text.slice(0, MAX_TEXT_CHARS) : p.text
    valid.push({ ...p, publishedAt, text })
  }
  return { valid, dropped }
}

/** detail.quota convention: a JSON nextCursor may carry a top-level `quota` object. */
function quotaFromCursor(cursor: string | undefined): Record<string, unknown> | undefined {
  if (!cursor || !cursor.startsWith('{')) return undefined
  try {
    const parsed: unknown = JSON.parse(cursor)
    const quota = (parsed as { quota?: unknown } | null)?.quota
    return quota && typeof quota === 'object' && !Array.isArray(quota)
      ? (quota as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

type PreviousRun = { startedAt: Date; cursor?: string }

/** The latest ok fetch_run of this source in the same mode (fixture runs never set a live cursor). */
async function previousOkRun(
  db: Db,
  sourceKey: SourceKey,
  mode: string,
): Promise<PreviousRun | null> {
  const e = schema.eventLog
  const [row] = await db
    .select({ at: e.at, detail: e.detail })
    .from(e)
    .where(
      and(
        eq(e.kind, 'fetch_run'),
        eq(e.sourceKey, sourceKey),
        eq(e.status, 'ok'),
        sql`${e.detail}->>'mode' = ${mode}`,
      ),
    )
    .orderBy(desc(e.at), desc(e.id))
    .limit(1)
  if (!row) return null
  const started = new Date(String(row.detail.startedAt ?? ''))
  const cursor = typeof row.detail.cursor === 'string' ? row.detail.cursor : undefined
  return { startedAt: Number.isNaN(started.getTime()) ? row.at : started, cursor }
}

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timeout after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

/** Runs the adapter; rejects with TimeoutError at `ms` even if the adapter ignores its signal. */
async function callWithTimeout(
  adapter: SourceAdapter,
  ctx: Omit<FetchContext, 'signal'>,
  ms: number,
): Promise<{ result: FetchResult; signal: AbortSignal }> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new TimeoutError(ms)
      controller.abort(err)
      reject(err)
    }, ms)
  })
  try {
    const result = await Promise.race([
      adapter.fetch({ ...ctx, signal: controller.signal }),
      timeout,
    ])
    return { result, signal: controller.signal }
  } finally {
    clearTimeout(timer)
  }
}

function redact(message: string, secrets: (string | undefined)[]): string {
  let out = message
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join('***')
  return out
}

const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message || e.name : typeof e === 'string' ? e : 'unknown error'

/**
 * Fetches one source and records the run. Mode: opts.modeOverride, else SOURCES_MODE (auto by
 * default) resolved against the credentials. Every call writes one fetch_run event with status
 * ok | error | rate_limited and detail {mode, startedAt, since, cursor, fetched, duplicates,
 * dropped, marketPoints, rateLimitedUntil?, quota?}. Never rejects.
 */
export async function runFetch(
  deps: RunnerDeps,
  sourceKey: SourceKey,
  opts: { modeOverride?: 'fixture' | 'live' } = {},
): Promise<RunOutcome> {
  const now = deps.now ?? (() => new Date())
  const startedAt = now()
  const t0 = performance.now()
  const outcome: RunOutcome = {
    sourceKey,
    status: 'error',
    mode: 'fixture',
    fetched: 0,
    inserted: 0,
    duplicates: 0,
    marketPoints: 0,
    costUsd: 0,
    durationMs: 0,
  }
  const detail: Record<string, unknown> = { startedAt: startedAt.toISOString() }
  let secrets: (string | undefined)[] = []

  try {
    const adapter = deps.adapters[sourceKey]
    if (!adapter) throw new Error(`no adapter registered for ${sourceKey}`)
    const { config } = await getLatestConfig(deps.db)
    const source = config.sources[sourceKey]
    const creds = resolveCreds(adapter, source, deps.env)
    secrets = Object.values(creds)

    const resolved: ResolvedMode =
      opts.modeOverride === 'fixture'
        ? { mode: 'fixture', reason: 'sources_mode' }
        : opts.modeOverride === 'live'
          ? resolveMode('live', adapter, creds)
          : resolveMode(parseSourcesMode(deps.env.SOURCES_MODE), adapter, creds)
    outcome.mode = resolved.mode
    detail.mode = resolved.mode
    if (resolved.mode === 'unconfigured') {
      throw new Error(`not configured: missing ${resolved.missing.join(', ')}`)
    }
    const mode = resolved.mode

    const prev = await previousOkRun(deps.db, sourceKey, mode)
    const since = prev
      ? new Date(prev.startedAt.getTime() - SINCE_OVERLAP_MS)
      : new Date(startedAt.getTime() - config.backfill_days * DAY_MS)
    detail.since = since.toISOString()
    detail.cursor = prev?.cursor ?? null

    const { result } = await callWithTimeout(
      adapter,
      { since, cursor: prev?.cursor, source, terms: config.terms, mode, creds },
      deps.timeoutsMs?.[sourceKey] ?? defaultTimeoutMs(sourceKey),
    )
    outcome.costUsd = Number.isFinite(result.costUsd) ? result.costUsd : 0

    const posts = Array.isArray(result.posts) ? result.posts : []
    const { valid, dropped } = sanitizePosts(posts, now())
    const laned = valid.map((p) => ({ ...p, lane: resolvePostLane(adapter.lane, p) }))
    const stored = await upsertPosts(deps.db, laned, { isFixture: mode === 'fixture', now: now() })

    const points: NormalizedMarketPoint[] = (result.marketPoints ?? []).map((p) =>
      mode === 'fixture' && !p.sourceUrl.endsWith(FIXTURE_URL_SUFFIX)
        ? { ...p, sourceUrl: p.sourceUrl + FIXTURE_URL_SUFFIX }
        : p,
    )
    const market = await insertMarketPoints(deps.db, points)

    outcome.status = 'ok'
    outcome.fetched = posts.length
    outcome.inserted = stored.inserted
    outcome.duplicates = stored.duplicates
    outcome.marketPoints = market.inserted
    Object.assign(detail, {
      cursor: result.nextCursor ?? prev?.cursor ?? null,
      fetched: posts.length,
      duplicates: stored.duplicates,
      dropped: dropped + stored.rejected,
      marketPoints: market.inserted,
    })
    const quota = quotaFromCursor(result.nextCursor)
    if (quota) detail.quota = quota
  } catch (e) {
    outcome.status = e instanceof RateLimitedError ? 'rate_limited' : 'error'
    outcome.error = redact(errorMessage(e), secrets)
    if (e instanceof RateLimitedError && !Number.isNaN(e.resetAt.getTime())) {
      detail.rateLimitedUntil = e.resetAt.toISOString()
    }
    detail.fetched ??= 0
    detail.duplicates ??= 0
    detail.dropped ??= 0
    detail.marketPoints ??= 0
  }

  outcome.durationMs = Math.max(0, Math.round(performance.now() - t0))
  try {
    await logEvent(deps.db, {
      kind: 'fetch_run',
      at: now(),
      sourceKey,
      // 'rate_limited' is stored as text; FetchRunStatus in @jio/core does not list it yet.
      status: outcome.status as FetchRunStatus,
      itemsNew: outcome.inserted,
      costUsd: outcome.costUsd,
      durationMs: outcome.durationMs,
      error: outcome.error,
      detail,
    })
  } catch (e) {
    outcome.status = 'error'
    outcome.error = `${outcome.error ? outcome.error + '; ' : ''}fetch_run not logged: ${redact(errorMessage(e), secrets)}`
  }
  return outcome
}
