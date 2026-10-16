// Everything the pipeline jobs need that talks to a model, built once at worker boot. Each piece
// falls back to its deterministic stub when its API key is empty, so tests (which always pass
// explicit empty keys) and fixture-mode runs never reach the network.
import type { Logger } from 'pino'
import type { TermsConfig } from '@jio/core'
import { getLatestConfig, type Db } from '@jio/db'
import { createClassifier, type ClassifierUsage } from '../classify/anthropic'
import type { Classifier } from '../classify/classifier'
import { createEmbedder, type Embedder } from '../classify/embedder'
import { createLogger } from '../log'
import type { Sql } from '../triage/repo'
import { loadFewShot } from './db'

export type PipelineHandle = { db: Db; sql: Sql }
export type PipelineLog = Pick<Logger, 'info' | 'warn' | 'error'>

export type UsageTotals = {
  calls: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

/** Accumulates classifier token usage between job runs; `take` reads and resets it. */
export class UsageMeter {
  private totals: UsageTotals = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }

  add(u: ClassifierUsage): void {
    this.totals.calls++
    this.totals.inputTokens += u.inputTokens
    this.totals.outputTokens += u.outputTokens
    this.totals.costUsd += u.costUsd
  }

  take(): UsageTotals {
    const t = this.totals
    this.totals = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
    return t
  }
}

export type PipelineDeps = {
  classifier: Classifier
  embedder: Embedder
  log: PipelineLog
  usage?: UsageMeter
}

/**
 * Wires the classifier (Anthropic when ANTHROPIC_API_KEY is set, else the keyword stub) with
 * few-shot examples from analyst corrections, and the embedder (Voyage when VOYAGE_API_KEY is set,
 * else the hashing stub). The stub classifier's terms come from the config at boot (or opts.terms).
 */
export async function createPipelineDeps(
  h: PipelineHandle,
  env: Record<string, string | undefined> = process.env,
  opts: { log?: PipelineLog; terms?: TermsConfig } = {},
): Promise<PipelineDeps> {
  const log = opts.log ?? createLogger()
  const terms = opts.terms ?? (await getLatestConfig(h.db)).config.terms
  const usage = new UsageMeter()
  const classifier = createClassifier({
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.CLASSIFIER_MODEL,
    terms,
    getFewShot: () => loadFewShot(h),
    onUsage: (u) => usage.add(u),
    log,
  })
  const embedder = createEmbedder({ apiKey: env.VOYAGE_API_KEY })
  return { classifier, embedder, log, usage }
}
