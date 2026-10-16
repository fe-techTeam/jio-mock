import type Anthropic from '@anthropic-ai/sdk'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  AnthropicSummarizer,
  MAX_SUMMARY_LINE,
  StubSummarizer,
  createSummarizer,
  type SummaryPost,
} from './summarizer'

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests')
  })
})
afterAll(() => {
  vi.unstubAllGlobals()
})

const POSTS: SummaryPost[] = [
  {
    text: 'Jio IPO GMP 120 chal raha hai',
    glossEn: 'Jio IPO GMP is running at 120',
    sentiment: 'positive',
  },
  { text: 'Valuation too rich', glossEn: null, sentiment: 'negative' },
]

function reply(text: string, stop: Anthropic.StopReason = 'end_turn'): Anthropic.Message {
  return {
    id: 'msg_test',
    container: null,
    content: [{ type: 'text', text, citations: null }] as Anthropic.ContentBlock[],
    diagnostics: null,
    model: 'claude-haiku-5-5',
    role: 'assistant',
    stop_details: null,
    stop_reason: stop,
    stop_sequence: null,
    type: 'message',
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      input_tokens: 500,
      output_tokens: 60,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: 'standard',
      speed: null,
    },
  } as Anthropic.Message
}

function fakeClient(make: () => Anthropic.Message) {
  const create = vi.fn(async (_body: Anthropic.MessageCreateParamsNonStreaming) => make())
  return { client: { messages: { create } } as unknown as Pick<Anthropic, 'messages'>, create }
}

describe('StubSummarizer', () => {
  const s = new StubSummarizer()

  it('gives a sentiment split for 30 or more items and quotes the most-reached gloss', async () => {
    const [l1, l2] = await s.summarize({ name: 'GMP' }, POSTS, {
      items: 40,
      pos: 20,
      neu: 10,
      neg: 10,
    })
    expect(l1).toBe('40 items in 24h: 50% positive, 25% neutral, 25% negative.')
    expect(l2).toBe('Most-reached: "Jio IPO GMP is running at 120"')
  })

  it('declines a split under 30 items and cuts the quote to 100 chars', async () => {
    const long = 'x'.repeat(300)
    const [l1, l2] = await s.summarize(
      { name: 'GMP' },
      [{ text: long, glossEn: null, sentiment: 'neutral' }],
      { items: 12, pos: 3, neu: 6, neg: 3 },
    )
    expect(l1).toBe('12 items in 24h (too few for a sentiment split).')
    expect(l2).toBe(`Most-reached: "${'x'.repeat(100)}"`)
    expect(l2.length).toBeLessThanOrEqual(MAX_SUMMARY_LINE)
  })
})

describe('createSummarizer', () => {
  it('returns the stub without a key and the Anthropic summarizer with one', () => {
    expect(createSummarizer({ apiKey: '' })).toBeInstanceOf(StubSummarizer)
    expect(createSummarizer({ apiKey: '  ' })).toBeInstanceOf(StubSummarizer)
    const { client } = fakeClient(() => reply('{}'))
    const a = createSummarizer({ apiKey: 'sk-test', model: 'claude-haiku-5-5', client })
    expect(a).toBeInstanceOf(AnthropicSummarizer)
    expect(a.model).toBe('claude-haiku-5-5')
  })
})

describe('AnthropicSummarizer', () => {
  it('sends structured-output JSON at low effort with posts wrapped as untrusted data', async () => {
    const { client, create } = fakeClient(() =>
      reply(
        JSON.stringify({ line1: 'People debate the GMP.', line2: 'Tone is turning cautious.' }),
      ),
    )
    const s = new AnthropicSummarizer({ apiKey: 'k', model: 'claude-haiku-5-5', client })
    const lines = await s.summarize({ name: 'GMP and grey market' }, POSTS, {
      items: 40,
      pos: 20,
      neu: 10,
      neg: 10,
    })
    expect(lines).toEqual(['People debate the GMP.', 'Tone is turning cautious.'])

    const body = create.mock.calls[0]![0]
    expect(body.model).toBe('claude-haiku-5-5')
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('thinking')
    expect(body.output_config).toMatchObject({
      effort: 'low',
      format: { type: 'json_schema' },
    })
    const schema = (body.output_config!.format as { schema: Record<string, unknown> }).schema
    expect(schema).toMatchObject({ required: ['line1', 'line2'], additionalProperties: false })
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0]!.role).toBe('user')
    const user = body.messages[0]!.content as string
    expect(user).toContain('<untrusted_posts>')
    expect(user).toContain('Jio IPO GMP 120 chal raha hai')
    const system = JSON.stringify(body.system)
    expect(system).toMatch(/never/i)
    expect(system).toMatch(/advice/i)
  })

  it('collapses newlines and cuts each line to 140 chars', async () => {
    const { client } = fakeClient(() =>
      reply(JSON.stringify({ line1: `a\nb ${'y'.repeat(300)}`, line2: 'ok' })),
    )
    const s = new AnthropicSummarizer({ apiKey: 'k', client })
    const [l1, l2] = await s.summarize({ name: 'T' }, POSTS, { items: 2, pos: 1, neu: 0, neg: 1 })
    expect(l1.includes('\n')).toBe(false)
    expect(l1.length).toBe(MAX_SUMMARY_LINE)
    expect(l2).toBe('ok')
  })

  it('throws on a refusal or a malformed reply so the caller can skip the topic', async () => {
    const refused = new AnthropicSummarizer({
      apiKey: 'k',
      client: fakeClient(() => reply('{}', 'refusal')).client,
    })
    await expect(
      refused.summarize({ name: 'T' }, POSTS, { items: 2, pos: 1, neu: 0, neg: 1 }),
    ).rejects.toThrow(/refusal/)
    const bad = new AnthropicSummarizer({
      apiKey: 'k',
      client: fakeClient(() => reply('not json')).client,
    })
    await expect(
      bad.summarize({ name: 'T' }, POSTS, { items: 2, pos: 1, neu: 0, neg: 1 }),
    ).rejects.toThrow()
  })
})
