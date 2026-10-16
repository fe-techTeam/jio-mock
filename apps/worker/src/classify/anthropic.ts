// LLM classifier on the Anthropic Messages API. One request per batch (batch.ts sizes them): a
// cached system prompt with the instructions, topic list and few-shot corrections, and a user
// message carrying the posts as wrapped untrusted data. Structured output (output_config.format)
// constrains the reply to the label schema; everything is still re-validated by normalizeResult.
//
// Haiku 5.5 returns 400 for sampling parameters, thinking budgets, disabled thinking, assistant
// prefill and forced tool selection, so the request sends none of them. Effort 'low' keeps the
// (always-on) adaptive thinking short.
import Anthropic from '@anthropic-ai/sdk'
import type { Logger } from 'pino'
import { z } from 'zod'
import type { TermsConfig, TopicDef } from '@jio/core'
import { classifiableTopics, lowResult, normalizeResult } from './classifier'
import type { Classifier, ClassifierInput, ClassifyResult, FewShotExample } from './classifier'
import { PROMPT_VERSION, buildOutputSchema, buildSystemPrompt, buildUserMessage } from './prompt'
import { StubClassifier } from './stub'

export const DEFAULT_CLASSIFIER_MODEL = 'claude-haiku-5-5'
export const CLASSIFIER_MAX_TOKENS = 8000
export const CLASSIFIER_MAX_RETRIES = 3

// Claude Haiku 5.5 list prices (prompts up to 100K tokens), USD per million tokens.
export const HAIKU_INPUT_USD_PER_MTOK = 0.1
export const HAIKU_OUTPUT_USD_PER_MTOK = 0.5
// Prompt-cache multipliers on the input price: writes 1.25x, reads 0.1x.
export const CACHE_WRITE_MULTIPLIER = 1.25
export const CACHE_READ_MULTIPLIER = 0.1

export type ClassifierUsage = { inputTokens: number; outputTokens: number; costUsd: number }

export type AnthropicClassifierOptions = {
  apiKey: string
  model?: string
  client?: Pick<Anthropic, 'messages'>
  getFewShot?: () => Promise<FewShotExample[]>
  onUsage?: (u: ClassifierUsage) => void
  log?: Pick<Logger, 'warn'>
}

const Reply = z.object({ results: z.array(z.unknown()) })
const RefOnly = z.object({ ref: z.string() })

export function usageCost(usage: Anthropic.Usage): ClassifierUsage {
  const uncached = usage.input_tokens
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const inputUnits =
    uncached + cacheWrite * CACHE_WRITE_MULTIPLIER + cacheRead * CACHE_READ_MULTIPLIER
  const costUsd =
    (inputUnits * HAIKU_INPUT_USD_PER_MTOK + usage.output_tokens * HAIKU_OUTPUT_USD_PER_MTOK) /
    1_000_000
  return {
    inputTokens: uncached + cacheWrite + cacheRead,
    outputTokens: usage.output_tokens,
    costUsd,
  }
}

export class AnthropicClassifier implements Classifier {
  readonly model: string
  readonly promptVersion = PROMPT_VERSION
  readonly client: Pick<Anthropic, 'messages'>
  private readonly getFewShot?: () => Promise<FewShotExample[]>
  private readonly onUsage?: (u: ClassifierUsage) => void
  private readonly log?: Pick<Logger, 'warn'>

  constructor(opts: AnthropicClassifierOptions) {
    this.model = opts.model || process.env.CLASSIFIER_MODEL || DEFAULT_CLASSIFIER_MODEL
    this.client =
      opts.client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: CLASSIFIER_MAX_RETRIES })
    this.getFewShot = opts.getFewShot
    this.onUsage = opts.onUsage
    this.log = opts.log
  }

  async classify(items: ClassifierInput[], topics: TopicDef[]): Promise<ClassifyResult[]> {
    if (items.length === 0) return []
    const slugs = classifiableTopics(topics).map((t) => t.slug)
    const fewShot = this.getFewShot ? await this.getFewShot() : []

    let reply: Anthropic.Message
    try {
      reply = await this.client.messages.create({
        model: this.model,
        max_tokens: CLASSIFIER_MAX_TOKENS,
        system: [
          {
            type: 'text',
            text: buildSystemPrompt(topics, fewShot),
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: buildUserMessage(items) }],
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: buildOutputSchema(slugs) },
        },
      })
    } catch (err) {
      // Rate limits, connection errors and 5xx (after the SDK's own retries) propagate so the
      // batch is retried next tick. A 400 will not get better on retry: label the batch low.
      if (err instanceof Anthropic.BadRequestError) {
        this.log?.warn(
          { err: err.message, model: this.model, items: items.length },
          'classifier request rejected; batch labelled unclassified',
        )
        return items.map((i) => lowResult(i.postId))
      }
      throw err
    }

    this.onUsage?.(usageCost(reply.usage))
    return this.parse(reply, items, new Set(slugs))
  }

  private parse(
    reply: Anthropic.Message,
    items: ClassifierInput[],
    validSlugs: Set<string>,
  ): ClassifyResult[] {
    const allLow = () => items.map((i) => lowResult(i.postId))
    if (reply.stop_reason === 'refusal' || reply.stop_reason === 'max_tokens') {
      this.log?.warn(
        { stopReason: reply.stop_reason, items: items.length },
        'classifier reply incomplete; batch labelled unclassified',
      )
      return allLow()
    }

    const text = reply.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text
    if (text === undefined) return allLow()

    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      this.log?.warn({ items: items.length }, 'classifier reply was not JSON')
      return allLow()
    }
    const parsed = Reply.safeParse(json)
    if (!parsed.success) return allLow()

    const byRef = new Map<string, unknown>()
    for (const raw of parsed.data.results) {
      const ref = RefOnly.safeParse(raw)
      if (ref.success && !byRef.has(ref.data.ref)) byRef.set(ref.data.ref, raw)
    }
    return items.map((item, i) => {
      const raw = byRef.get(`p${i}`)
      return raw === undefined
        ? lowResult(item.postId)
        : normalizeResult(raw, item.postId, validSlugs)
    })
  }
}

export type CreateClassifierOptions = {
  apiKey?: string
  model?: string
  terms: TermsConfig
  getFewShot?: () => Promise<FewShotExample[]>
  onUsage?: (u: ClassifierUsage) => void
  client?: Pick<Anthropic, 'messages'>
  log?: Pick<Logger, 'warn'>
}

/** Anthropic when an API key is set, otherwise the deterministic stub. */
export function createClassifier(opts: CreateClassifierOptions): Classifier {
  const apiKey = opts.apiKey?.trim()
  if (!apiKey) return new StubClassifier({ terms: opts.terms })
  return new AnthropicClassifier({
    apiKey,
    model: opts.model,
    client: opts.client,
    getFewShot: opts.getFewShot,
    onUsage: opts.onUsage,
    log: opts.log,
  })
}
