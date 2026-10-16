import Anthropic from '@anthropic-ai/sdk'
import type { Logger } from 'pino'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, SEED_TOPICS } from '@jio/core'
import { AnthropicClassifier, createClassifier } from './anthropic'
import type { ClassifierInput, FewShotExample } from './classifier'
import { PROMPT_VERSION, buildOutputSchema, buildUserMessage } from './prompt'
import { StubClassifier } from './stub'

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests')
  })
})
afterAll(() => {
  vi.unstubAllGlobals()
})

const SEED_SLUGS = SEED_TOPICS.filter((t) => t.kind === 'seed').map((t) => t.slug)

const ITEMS: ClassifierInput[] = [
  { postId: 'post-a', text: 'Jio IPO GMP kitna?', lang: 'hinglish' },
  { postId: 'post-b', text: 'Valuation looks stretched', lang: 'en' },
  { postId: 'post-c', text: 'जियो नेटवर्क खराब है', lang: 'hi' },
]

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number }

function message(
  text: string | null,
  stop_reason: Anthropic.StopReason = 'end_turn',
  usage: Usage = { input_tokens: 1000, output_tokens: 200 },
): Anthropic.Message {
  const content = (
    text === null ? [] : [{ type: 'text', text, citations: null }]
  ) as Anthropic.ContentBlock[]
  return {
    id: 'msg_test',
    container: null,
    content,
    diagnostics: null,
    model: 'claude-haiku-5-5',
    role: 'assistant',
    stop_details: null,
    stop_reason,
    stop_sequence: null,
    type: 'message',
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
      inference_geo: null,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: 'standard',
      speed: null,
    },
  }
}

const result = (ref: string, topic: string, extra: Record<string, unknown> = {}) => ({
  ref,
  topic,
  sentiment: 'neutral',
  entities: ['jio'],
  confidence: 'high',
  gloss_en: '',
  ...extra,
})

function fakeClient(reply: Anthropic.Message | Error) {
  const create = vi.fn(async (_params: Anthropic.MessageCreateParamsNonStreaming) => {
    if (reply instanceof Error) throw reply
    return reply
  })
  const client = { messages: { create } } as unknown as Pick<Anthropic, 'messages'>
  return { client, create }
}

function classifier(
  reply: Anthropic.Message | Error,
  extra: Partial<ConstructorParameters<typeof AnthropicClassifier>[0]> = {},
) {
  const { client, create } = fakeClient(reply)
  const c = new AnthropicClassifier({
    apiKey: 'test-key',
    model: 'claude-haiku-5-5',
    client,
    ...extra,
  })
  return { c, create }
}

const okReply = () =>
  message(
    JSON.stringify({
      results: [
        result('p2', 'customer-experience', {
          sentiment: 'negative',
          gloss_en: 'The Jio network is bad',
        }),
        result('p0', 'gmp-grey-market', { sentiment: 'positive' }),
        result('p1', 'valuation-price-band', { entities: [] }),
      ],
    }),
  )

describe('AnthropicClassifier request', () => {
  it('sends one structured-output request with a cached system block and no sampling params', async () => {
    const { c, create } = classifier(okReply())
    await c.classify(ITEMS, SEED_TOPICS)
    expect(create).toHaveBeenCalledTimes(1)
    const params = create.mock.calls[0]![0]
    expect(params.model).toBe('claude-haiku-5-5')
    expect(params.max_tokens).toBe(8000)
    expect(params.output_config).toEqual({
      effort: 'low',
      format: { type: 'json_schema', schema: buildOutputSchema(SEED_SLUGS) },
    })
    expect(Array.isArray(params.system)).toBe(true)
    const system = params.system as Anthropic.TextBlockParam[]
    expect(system).toHaveLength(1)
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' })
    expect(system[0]!.text).toContain('untrusted_posts')
    expect(params.messages).toEqual([{ role: 'user', content: buildUserMessage(ITEMS) }])
    for (const key of ['temperature', 'top_p', 'top_k', 'thinking', 'tool_choice', 'tools']) {
      expect(params).not.toHaveProperty(key)
    }
    expect(JSON.stringify(params)).not.toContain('post-a')
  })

  it('identifies itself with the model and prompt version', () => {
    const { c } = classifier(okReply())
    expect(c.model).toBe('claude-haiku-5-5')
    expect(c.promptVersion).toBe(PROMPT_VERSION)
  })

  it('defaults the model to CLASSIFIER_MODEL, then claude-haiku-5-5', () => {
    const { client } = fakeClient(okReply())
    vi.stubEnv('CLASSIFIER_MODEL', 'claude-test-model')
    expect(new AnthropicClassifier({ apiKey: 'k', client }).model).toBe('claude-test-model')
    vi.stubEnv('CLASSIFIER_MODEL', '')
    expect(new AnthropicClassifier({ apiKey: 'k', client }).model).toBe('claude-haiku-5-5')
    vi.unstubAllEnvs()
  })

  it('builds a real SDK client with maxRetries 3 when none is injected', () => {
    const c = new AnthropicClassifier({ apiKey: 'k', model: 'm' })
    expect(c.client).toBeInstanceOf(Anthropic)
    expect((c.client as Anthropic).maxRetries).toBe(3)
  })

  it('puts few-shot examples from getFewShot into the system prompt', async () => {
    const fewShot: FewShotExample[] = [
      {
        text: 'kostak 200 chal raha',
        lang: 'hinglish',
        topicSlug: 'gmp-grey-market',
        sentiment: 'neutral',
        entities: [],
      },
    ]
    const getFewShot = vi.fn(async () => fewShot)
    const { c, create } = classifier(okReply(), { getFewShot })
    await c.classify(ITEMS, SEED_TOPICS)
    const system = create.mock.calls[0]![0].system as Anthropic.TextBlockParam[]
    expect(system[0]!.text).toContain('kostak 200 chal raha')
    expect(getFewShot).toHaveBeenCalledTimes(1)
  })

  it('makes no call for an empty batch', async () => {
    const { c, create } = classifier(okReply())
    expect(await c.classify([], SEED_TOPICS)).toEqual([])
    expect(create).not.toHaveBeenCalled()
  })
})

describe('AnthropicClassifier response handling', () => {
  it('maps refs back to postIds in input order', async () => {
    const { c } = classifier(okReply())
    const out = await c.classify(ITEMS, SEED_TOPICS)
    expect(out).toEqual([
      {
        postId: 'post-a',
        topicSlug: 'gmp-grey-market',
        sentiment: 'positive',
        entities: ['jio'],
        confidence: 'high',
        glossEn: null,
      },
      {
        postId: 'post-b',
        topicSlug: 'valuation-price-band',
        sentiment: 'neutral',
        entities: [],
        confidence: 'high',
        glossEn: null,
      },
      {
        postId: 'post-c',
        topicSlug: 'customer-experience',
        sentiment: 'negative',
        entities: ['jio'],
        confidence: 'high',
        glossEn: 'The Jio network is bad',
      },
    ])
  })

  it('reads the first text block after any thinking block', async () => {
    const reply = okReply()
    reply.content = [
      { type: 'thinking', thinking: '', signature: 's' } as Anthropic.ContentBlock,
      ...reply.content,
    ]
    const { c } = classifier(reply)
    const out = await c.classify(ITEMS, SEED_TOPICS)
    expect(out[0]!.topicSlug).toBe('gmp-grey-market')
  })

  it('sends an unknown topic to unclassified/low', async () => {
    const reply = message(
      JSON.stringify({
        results: [
          result('p0', 'emerging'),
          result('p1', 'made-up'),
          result('p2', 'gmp-grey-market'),
        ],
      }),
    )
    const { c } = classifier(reply)
    const out = await c.classify(ITEMS, SEED_TOPICS)
    expect(out.map((r) => [r.topicSlug, r.confidence])).toEqual([
      ['unclassified', 'low'],
      ['unclassified', 'low'],
      ['gmp-grey-market', 'high'],
    ])
  })

  it.each(['refusal', 'max_tokens'] as const)(
    'labels every item low when stop_reason is %s',
    async (stop) => {
      const full = okReply().content[0] as Anthropic.TextBlock
      const { c } = classifier(message(full.text, stop))
      const out = await c.classify(ITEMS, SEED_TOPICS)
      expect(out.map((r) => r.postId)).toEqual(['post-a', 'post-b', 'post-c'])
      for (const r of out)
        expect(r).toMatchObject({ topicSlug: 'unclassified', confidence: 'low', glossEn: null })
    },
  )

  it.each([
    ['malformed JSON', message('{"results": [ {"ref": "p0",')],
    ['a wrong top-level shape', message('{"labels": []}')],
    ['no text block', message(null)],
  ])('labels every item low for %s', async (_label, reply) => {
    const { c } = classifier(reply)
    const out = await c.classify(ITEMS, SEED_TOPICS)
    expect(out).toHaveLength(3)
    for (const r of out) expect(r).toMatchObject({ topicSlug: 'unclassified', confidence: 'low' })
  })

  it('labels a missing ref low, keeps the first of duplicate refs, and ignores unknown refs', async () => {
    const reply = message(
      JSON.stringify({
        results: [
          result('p0', 'gmp-grey-market'),
          result('p0', 'telecom-business'),
          result('p9', 'telecom-business'),
          'not an object',
          result('p2', 'customer-experience'),
        ],
      }),
    )
    const { c } = classifier(reply)
    const out = await c.classify(ITEMS, SEED_TOPICS)
    expect(out.map((r) => r.topicSlug)).toEqual([
      'gmp-grey-market',
      'unclassified',
      'customer-experience',
    ])
    expect(out[1]!.confidence).toBe('low')
  })

  it('reports usage and cost to onUsage', async () => {
    const onUsage = vi.fn()
    const { c } = classifier(
      message('{"results":[]}', 'end_turn', { input_tokens: 1000, output_tokens: 200 }),
      { onUsage },
    )
    await c.classify(ITEMS, SEED_TOPICS)
    expect(onUsage).toHaveBeenCalledTimes(1)
    const u = onUsage.mock.calls[0]![0]
    expect(u.inputTokens).toBe(1000)
    expect(u.outputTokens).toBe(200)
    expect(u.costUsd).toBeCloseTo(0.0002, 10)
  })

  it('counts cache reads as input at the cache-read rate', async () => {
    const onUsage = vi.fn()
    const reply = message('{"results":[]}', 'end_turn', {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000,
    })
    const { c } = classifier(reply, { onUsage })
    await c.classify(ITEMS, SEED_TOPICS)
    expect(onUsage.mock.calls[0]![0].inputTokens).toBe(1_000_000)
    expect(onUsage.mock.calls[0]![0].costUsd).toBeCloseTo(0.01, 10)
  })
})

describe('AnthropicClassifier errors', () => {
  it('rethrows rate limits so the batch is retried next tick', async () => {
    const err = new Anthropic.RateLimitError(429, { type: 'error' }, 'rate limited', new Headers())
    const { c } = classifier(err)
    await expect(c.classify(ITEMS, SEED_TOPICS)).rejects.toBeInstanceOf(Anthropic.RateLimitError)
  })

  it('rethrows connection errors and 5xx errors', async () => {
    const conn = new Anthropic.APIConnectionError({ message: 'socket hang up' })
    await expect(classifier(conn).c.classify(ITEMS, SEED_TOPICS)).rejects.toBe(conn)
    const overloaded = new Anthropic.InternalServerError(
      529,
      { type: 'error' },
      'overloaded',
      new Headers(),
    )
    await expect(classifier(overloaded).c.classify(ITEMS, SEED_TOPICS)).rejects.toBe(overloaded)
  })

  it('turns a bad request into low results and logs the message', async () => {
    const warn = vi.fn()
    const log = { warn } as unknown as Pick<Logger, 'warn'>
    const err = new Anthropic.BadRequestError(
      400,
      { type: 'error', error: { type: 'invalid_request_error', message: 'schema too complex' } },
      undefined,
      new Headers(),
    )
    const { c } = classifier(err, { log })
    const out = await c.classify(ITEMS, SEED_TOPICS)
    expect(out.map((r) => r.confidence)).toEqual(['low', 'low', 'low'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(warn.mock.calls[0])).toContain('schema too complex')
  })
})

describe('createClassifier', () => {
  const terms = structuredClone(DEFAULT_CONFIG.terms)

  it('returns the stub without a key', () => {
    expect(createClassifier({ terms })).toBeInstanceOf(StubClassifier)
    expect(createClassifier({ apiKey: '', terms })).toBeInstanceOf(StubClassifier)
    expect(createClassifier({ apiKey: '   ', terms })).toBeInstanceOf(StubClassifier)
  })

  it('returns the Anthropic classifier with a key', () => {
    const { client } = fakeClient(okReply())
    const c = createClassifier({ apiKey: 'k', terms, client, model: 'claude-haiku-5-5' })
    expect(c).toBeInstanceOf(AnthropicClassifier)
    expect(c.model).toBe('claude-haiku-5-5')
  })
})
