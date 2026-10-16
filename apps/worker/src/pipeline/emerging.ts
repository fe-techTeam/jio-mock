// Emerging candidates: model-labelled 'unclassified' posts from the last 72h are leader-clustered
// on their embeddings. A cluster with >= 5 posts and >= 3 distinct authors becomes (or joins) an
// emerging topic, and its members get a new origin='model' row pointing at that topic, so they
// leave the unclassified bucket on the next rollup. Re-running on the same data is a no-op: the
// members are no longer unclassified. Posts an analyst labelled (correction/gold) are never moved.
import { createHash } from 'node:crypto'
import type { Confidence, EntityKey, Sentiment } from '@jio/core'
import { UNCLASSIFIED_SLUG } from '../classify/classifier'
import { normalizeForHash } from '../triage/hash'
import { centroid, cosine } from '../triage/vector'
import type { PipelineDeps, PipelineHandle } from './deps'

export const CLUSTER_COSINE = 0.8
export const ATTACH_COSINE = 0.85
export const MIN_CLUSTER_POSTS = 5
export const MIN_CLUSTER_AUTHORS = 3
export const EMERGING_WINDOW_HOURS = 72
export const EMERGING_MODEL = 'emerging-cluster'
export const EMERGING_PROMPT_VERSION = 'emerging-v1'
const SAMPLE_CHARS = 120
const IST_OFFSET_MS = 330 * 60_000

export type ClusterItem = {
  id: string
  authorId: string | null
  vector: number[]
  publishedAt?: Date
}
export type Cluster<T extends ClusterItem = ClusterItem> = { members: T[]; centroid: number[] }

/**
 * Leader clustering: items are visited in publishedAt order (input order breaks ties) and join
 * the cluster whose running centroid is most similar, when that similarity is >= threshold;
 * otherwise they start a new cluster.
 */
export function clusterUnclassified<T extends ClusterItem>(
  items: T[],
  threshold = CLUSTER_COSINE,
): Cluster<T>[] {
  const ordered = items
    .map((it, i) => ({ it, i }))
    .sort(
      (a, b) =>
        (a.it.publishedAt?.getTime() ?? 0) - (b.it.publishedAt?.getTime() ?? 0) || a.i - b.i,
    )
    .map((x) => x.it)
  const clusters: Cluster<T>[] = []
  for (const it of ordered) {
    let best = -1
    let bestSim = -Infinity
    clusters.forEach((c, k) => {
      const sim = cosine(it.vector, c.centroid)
      if (sim > bestSim) {
        bestSim = sim
        best = k
      }
    })
    if (best >= 0 && bestSim >= threshold) {
      const c = clusters[best]!
      c.members.push(it)
      c.centroid = centroid(c.members.map((m) => m.vector))
    } else {
      clusters.push({ members: [it], centroid: centroid([it.vector]) })
    }
  }
  return clusters
}

/** >= minPosts members and >= minAuthors distinct authors; every null author counts as distinct. */
export function isCandidate(
  cluster: Cluster,
  opts: { minPosts?: number; minAuthors?: number } = {},
): boolean {
  const minPosts = opts.minPosts ?? MIN_CLUSTER_POSTS
  const minAuthors = opts.minAuthors ?? MIN_CLUSTER_AUTHORS
  if (cluster.members.length < minPosts) return false
  const known = new Set<string>()
  let unknown = 0
  for (const m of cluster.members) {
    if (m.authorId === null) unknown++
    else known.add(m.authorId)
  }
  return known.size + unknown >= minAuthors
}

/** `emerging-<yyyymmdd (IST)>-<first 6 hex of sha256(sorted member ids)>`. */
export function emergingSlug(now: Date, memberIds: string[]): string {
  const day = new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10).replace(/-/g, '')
  const hash = createHash('sha256')
    .update([...memberIds].sort().join(','))
    .digest('hex')
    .slice(0, 6)
  return `emerging-${day}-${hash}`
}

/** Function words plus the words every tracked post shares, which say nothing about the topic. */
const STOPWORDS = new Set(
  (
    'the and for are but not you your with this that from have has had was were will would ' +
    'can could should about what when where which who whom how why its into than then them ' +
    'they their there these those our out all any some more most very just also only over ' +
    'such been being does did doing get got one two too yes now via per amp rt ' +
    'hai hain kya bhi aur nahi nahin kar karo kare raha rahe rahi tha thi the koi yeh woh ' +
    'jio ipo ipos reliance ril platforms share shares ' +
    'है हैं का की के में से को पर और भी यह वह जियो आईपीओ ' +
    'છે અને માં નો ની નું જિયો આઈપીઓ'
  ).split(/\s+/),
)
const TOKEN_RE = /[\p{L}\p{M}\p{N}]+/gu

/**
 * The n tokens found in the most texts (document frequency), ignoring stopwords, pure numbers and
 * tokens under 3 characters; ties break alphabetically so names are deterministic.
 */
export function topTokens(texts: string[], n: number): string[] {
  const df = new Map<string, number>()
  for (const t of texts) {
    const seen = new Set(
      (normalizeForHash(t).match(TOKEN_RE) ?? []).filter(
        (tok) => Array.from(tok).length >= 3 && !/^\p{N}+$/u.test(tok) && !STOPWORDS.has(tok),
      ),
    )
    for (const tok of seen) df.set(tok, (df.get(tok) ?? 0) + 1)
  }
  return [...df.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, n)
    .map(([tok]) => tok)
}

type Member = ClusterItem & {
  text: string
  sentiment: Sentiment
  entities: EntityKey[]
  confidence: Confidence
  glossEn: string | null
}

export type EmergingResult = {
  scanned: number
  clusters: number
  candidates: number
  created: number
  attached: number
  labelled: number
  skipped: number
}

const parseVector = (v: string | number[]): number[] =>
  Array.isArray(v) ? v : (JSON.parse(v) as number[])

export async function runEmerging(
  h: PipelineHandle,
  deps: Pick<PipelineDeps, 'log'>,
  now: Date = new Date(),
): Promise<EmergingResult> {
  const from = new Date(now.getTime() - EMERGING_WINDOW_HOURS * 3_600_000).toISOString()
  const to = now.toISOString()
  const rows = await h.sql<
    {
      id: string
      author_id: string | null
      embedding: string
      published_at: string
      text: string
      sentiment: Sentiment
      entities: EntityKey[]
      confidence: Confidence
      gloss_en: string | null
    }[]
  >`
    select p.id, p.author_id, p.embedding::text as embedding, p.published_at, p.text,
           ec.sentiment, ec.entities, ec.confidence, ec.gloss_en
    from posts p
    join effective_classifications ec on ec.post_id = p.id
    join topics t on t.id = ec.topic_id
    where t.slug = ${UNCLASSIFIED_SLUG} and ec.origin = 'model'
      and p.embedding is not null
      and p.published_at > ${from}::timestamptz and p.published_at <= ${to}::timestamptz
    order by p.published_at, p.id`
  const items: Member[] = rows.map((r) => ({
    id: r.id,
    authorId: r.author_id,
    vector: parseVector(r.embedding),
    publishedAt: new Date(r.published_at),
    text: r.text,
    sentiment: r.sentiment,
    entities: [...r.entities],
    confidence: r.confidence,
    glossEn: r.gloss_en,
  }))

  const clusters = clusterUnclassified(items)
  const candidates = clusters.filter((c) => isCandidate(c))
  const result: EmergingResult = {
    scanned: items.length,
    clusters: clusters.length,
    candidates: candidates.length,
    created: 0,
    attached: 0,
    labelled: 0,
    skipped: 0,
  }

  if (candidates.length > 0) {
    // Member centroids of the live emerging topics (the generic 'emerging' row is never a target).
    const existingRows = await h.sql<{ id: string; embedding: string }[]>`
      select t.id, p.embedding::text as embedding
      from topics t
      join effective_classifications ec on ec.topic_id = t.id
      join posts p on p.id = ec.post_id
      where t.kind = 'emerging' and t.slug <> 'emerging' and t.status <> 'dismissed'
        and p.embedding is not null`
    const byTopic = new Map<string, number[][]>()
    for (const r of existingRows) {
      const list = byTopic.get(r.id) ?? []
      list.push(parseVector(r.embedding))
      byTopic.set(r.id, list)
    }
    const existing = [...byTopic.entries()].map(([id, vs]) => ({ id, centroid: centroid(vs) }))

    for (const c of candidates) {
      let target: { id: string; sim: number } | null = null
      for (const e of existing) {
        const sim = cosine(c.centroid, e.centroid)
        if (sim >= ATTACH_COSINE && (!target || sim > target.sim)) target = { id: e.id, sim }
      }

      // Topic and member rows commit together, so a failure never leaves an empty topic.
      const topicId = await h.sql.begin(async (tx) => {
        let id = target?.id ?? null
        let created = false
        if (!id) {
          const slug = emergingSlug(
            now,
            c.members.map((m) => m.id),
          )
          const tokens = topTokens(
            c.members.map((m) => m.text),
            3,
          )
          const name =
            tokens.length >= 2 ? `Emerging: ${tokens[0]} ${tokens[1]}` : 'Emerging: new cluster'
          const description = c.members
            .slice(0, 3)
            .map((m) =>
              Array.from(m.text.replace(/\s+/g, ' ').trim()).slice(0, SAMPLE_CHARS).join(''),
            )
            .join('\n')
          const inserted = await tx<{ id: string }[]>`
            insert into topics (slug, name, kind, description, example_phrases, status)
            values (${slug}, ${name}, 'emerging', ${description}, ${tx.array(tokens)}::text[],
                    'active')
            on conflict (slug) do nothing
            returning id`
          if (inserted[0]) {
            id = inserted[0].id
            created = true
          } else {
            const [row] = await tx<{ id: string; status: string }[]>`
              select id, status from topics where slug = ${slug}`
            if (!row || row.status === 'dismissed') return null
            id = row.id
          }
        }
        for (const m of c.members) {
          await tx`
            insert into classifications (post_id, origin, topic_id, sentiment, entities,
                                         confidence, gloss_en, model, prompt_version, created_at)
            values (${m.id}, 'model', ${id}, ${m.sentiment}, ${tx.array(m.entities)}::text[],
                    ${m.confidence}, ${m.glossEn}, ${EMERGING_MODEL}, ${EMERGING_PROMPT_VERSION},
                    ${to}::timestamptz)`
        }
        if (created) result.created++
        else result.attached++
        return id
      })
      if (!topicId) {
        result.skipped++
        continue
      }
      result.labelled += c.members.length
      if (!target) existing.push({ id: topicId, centroid: c.centroid })
    }
  }

  deps.log.info({ ...result }, 'emerging run')
  return result
}
