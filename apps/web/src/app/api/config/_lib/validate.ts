// Pure validation for operator-edited terms and retention. Shared by the API and the Settings UI,
// so it imports only types from @jio/core and nothing server-side.
import type { TermsConfig } from '@jio/core'
import type { RetentionDays, ValidationIssue } from './contract'

export const MAX_TERM_CHARS = 80
export const MAX_LIST_ENTRIES = 500
export const ENTITY_KEYS_FIXED = ['mukesh', 'akash', 'isha', 'jio'] as const

/** Single tokens that cannot identify the IPO on their own ('jio' means 'live' in Hindi). */
export const BARE_AMBIGUOUS = ['jio', 'जियो', 'જિયો', 'reliance', 'ambani', 'अंबानी', 'અંબાણી']

export const BARE_JIO_MESSAGE =
  "'jio' alone means 'live' in Hindi; use it with an IPO term, e.g. 'Jio IPO'"

export type TermsValidation =
  | { ok: true; errors: []; normalized: TermsConfig }
  | { ok: false; errors: ValidationIssue[]; normalized: TermsConfig }

export const cleanTerm = (s: string): string => s.normalize('NFC').trim().replace(/\s+/g, ' ')
const key = (s: string) => cleanTerm(s).toLowerCase().replace(/^#/, '')

const HASHTAG = /^#[\p{L}\p{N}_]+$/u

function normalizeList(
  raw: readonly string[],
  path: string,
  errors: ValidationIssue[],
  opts: { hashtag?: boolean; noBare?: boolean; min?: number } = {},
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  if (raw.length > MAX_LIST_ENTRIES) {
    errors.push({ path, message: `At most ${MAX_LIST_ENTRIES} entries` })
  }
  raw.forEach((value, i) => {
    let t = cleanTerm(String(value))
    const at = `${path}[${i}]`
    if (!t) {
      errors.push({ path: at, message: 'Term cannot be empty' })
      return
    }
    if (opts.hashtag && !t.startsWith('#')) t = `#${t}`
    if (t.length > MAX_TERM_CHARS) {
      errors.push({
        path: at,
        message: `'${t.slice(0, 20)}...' is over ${MAX_TERM_CHARS} characters`,
      })
      return
    }
    if (opts.hashtag && !HASHTAG.test(t)) {
      errors.push({ path: at, message: `'${t}' is not a valid hashtag (letters, numbers, _)` })
      return
    }
    if (opts.noBare && BARE_AMBIGUOUS.includes(t.toLowerCase())) {
      errors.push({ path: at, message: BARE_JIO_MESSAGE })
      return
    }
    const k = t.toLowerCase()
    if (seen.has(k)) {
      errors.push({ path: at, message: `Duplicate term '${t}'` })
      return
    }
    seen.add(k)
    out.push(t)
  })
  if (opts.min && out.length < opts.min && !errors.some((e) => e.path.startsWith(path))) {
    errors.push({ path, message: `At least ${opts.min} required` })
  }
  return out
}

export function validateTerms(input: TermsConfig): TermsValidation {
  const errors: ValidationIssue[] = []
  const entities = {} as TermsConfig['entities']
  for (const k of ENTITY_KEYS_FIXED) {
    const e = input.entities?.[k]
    entities[k] = {
      label: e?.label ?? k,
      aliases: normalizeList(e?.aliases ?? [], `entities.${k}.aliases`, errors, {
        noBare: true,
        min: 1,
      }),
    }
  }
  const normalized: TermsConfig = {
    ...input,
    ipo_terms: normalizeList(input.ipo_terms ?? [], 'ipo_terms', errors, { noBare: true }),
    hashtags: normalizeList(input.hashtags ?? [], 'hashtags', errors, { hashtag: true }),
    entities,
    cooccurrence_terms: normalizeList(
      input.cooccurrence_terms ?? [],
      'cooccurrence_terms',
      errors,
      {
        noBare: true,
        min: 1,
      },
    ),
    negative_terms: normalizeList(input.negative_terms ?? [], 'negative_terms', errors),
  }

  const negatives = new Set(normalized.negative_terms.map(key))
  const includes: [string, string[]][] = [
    ['ipo_terms', normalized.ipo_terms],
    ['hashtags', normalized.hashtags],
    ['cooccurrence_terms', normalized.cooccurrence_terms],
    ...ENTITY_KEYS_FIXED.map((k): [string, string[]] => [
      `entities.${k}.aliases`,
      normalized.entities[k].aliases,
    ]),
  ]
  for (const [path, list] of includes) {
    list.forEach((t, i) => {
      if (negatives.has(key(t))) {
        errors.push({
          path: `${path}[${i}]`,
          message: `'${t}' is also in the negative terms; remove it from one list`,
        })
      }
    })
  }
  return errors.length === 0
    ? { ok: true, errors: [], normalized }
    : { ok: false, errors, normalized }
}

const intIn = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max

export function validateRetention(r: RetentionDays): ValidationIssue[] {
  const errors: ValidationIssue[] = []
  for (const k of ['raw_json', 'post_text', 'authors'] as const) {
    if (!intIn(r?.[k], 1, 3650)) {
      errors.push({ path: `retentionDays.${k}`, message: 'Whole number of days, 1 to 3650' })
    }
  }
  if (errors.length === 0 && r.raw_json > r.post_text) {
    errors.push({
      path: 'retentionDays.raw_json',
      message: 'Raw payload days cannot exceed post text days',
    })
  }
  return errors
}

export function validateThresholds(v: {
  minItemsForSplit?: unknown
  activeMinItems24h?: unknown
}): ValidationIssue[] {
  const errors: ValidationIssue[] = []
  if (v.minItemsForSplit !== undefined && !intIn(v.minItemsForSplit, 1, 1000)) {
    errors.push({ path: 'minItemsForSplit', message: 'Whole number, 1 to 1000' })
  }
  if (v.activeMinItems24h !== undefined && !intIn(v.activeMinItems24h, 1, 10000)) {
    errors.push({ path: 'activeMinItems24h', message: 'Whole number, 1 to 10000' })
  }
  return errors
}
