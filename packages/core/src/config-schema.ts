// Versioned app config (brew Data > Config). JSON keys are snake_case; every field that is not a
// term list has a default so old config_versions rows keep parsing as the schema grows.
import { z } from 'zod'
import {
  COVERAGE_LABELS,
  LANES,
  SOURCE_DEFAULT_LANE,
  SOURCE_KEYS,
  X_TIERS,
  type SourceKey,
} from './types'

export const TermList = z.array(z.string().trim().min(1).max(100))

const EntityConfig = z.object({
  label: z.string().trim().min(1),
  aliases: TermList.min(1),
})

/**
 * Keyword lists. Strong lists (ipo_terms, hashtags, entity aliases) match alone. anchor_groups are
 * ambiguous words ('jio' means 'live' in Hindi) that need a qualifier (cooccurrence_terms or
 * generic_hashtags) or an anchor from a second group. negative_terms are masked out first.
 */
export const TermsConfig = z.object({
  ipo_terms: TermList,
  hashtags: TermList,
  generic_hashtags: TermList,
  entities: z.object({
    mukesh: EntityConfig,
    akash: EntityConfig,
    isha: EntityConfig,
    jio: EntityConfig,
  }),
  anchor_groups: z.array(z.object({ name: z.string().trim().min(1), terms: TermList.min(1) })),
  cooccurrence_terms: TermList,
  negative_terms: TermList,
})
export type TermsConfig = z.infer<typeof TermsConfig>

const IntervalMin = z.number().int().min(1).max(1440)

export const SourceConfig = z.object({
  enabled: z.boolean().default(true),
  lane: z.enum(LANES),
  interval_min: IntervalMin,
  market_hours_interval_min: IntervalMin.nullable().default(null),
  coverage_label: z.enum(COVERAGE_LABELS).default('full_search'),
  x_tier: z.enum(X_TIERS).nullable().default(null),
  rate_limits: z.record(z.string(), z.number()).default({}),
  /**
   * Credentials saved from the Sources page: env-style name (e.g. X_BEARER_TOKEN) to an encrypted
   * `enc:v1:` blob. Never returned by an API.
   */
  creds_ref: z.record(z.string(), z.string()).nullable().default(null),
  params: z.record(z.string(), z.unknown()).default({}),
})
export type SourceConfig = z.infer<typeof SourceConfig>

const sourcesShape = Object.fromEntries(SOURCE_KEYS.map((k) => [k, SourceConfig])) as Record<
  SourceKey,
  typeof SourceConfig
>

export const AppConfig = z.object({
  terms: TermsConfig,
  sources: z.object(sourcesShape),
  retention_days: z
    .object({
      raw_json: z.number().int().min(1).default(30),
      post_text: z.number().int().min(1).default(90),
      authors: z.number().int().min(1).default(90),
    })
    .refine((r) => r.raw_json <= r.post_text, {
      message: 'raw_json retention cannot exceed post_text retention',
      path: ['raw_json'],
    })
    .default({}),
  min_items_for_split: z.number().int().min(1).default(30),
  active_min_items_24h: z.number().int().min(1).default(10),
  backfill_days: z.number().int().min(0).max(30).default(7),
  /** Locked off until counsel decides; cannot be set true. */
  person_level_views: z.literal(false).default(false),
})
export type AppConfig = z.infer<typeof AppConfig>
/** Input shape (defaults optional), e.g. an old config_versions row. */
export type AppConfigInput = z.input<typeof AppConfig>

// ---------------------------------------------------------------------------------------------
// Defaults. Term lists are the brew Assumptions (judge and designer lists, union, deduplicated
// case-insensitively), partitioned into strong terms (match alone) and anchors (need a qualifier).

const DEFAULT_TERMS: TermsConfig = {
  ipo_terms: [
    // EN company and IPO phrases
    'Jio IPO',
    'Jio Platforms IPO',
    'Reliance Jio IPO',
    'JPL IPO',
    'Jio Platforms',
    'Jio Platforms Ltd',
    'Reliance Jio',
    'Reliance Jio Infocomm',
    'RJIL',
    'Jio listing',
    'Jio listing date',
    'Jio listing gains',
    'Jio GMP',
    'Jio grey market premium',
    'Jio kostak',
    'Jio subject to sauda',
    'Jio allotment',
    'Jio allotment status',
    'Jio subscription status',
    'Jio price band',
    'Jio lot size',
    'Jio DRHP',
    'Jio RHP',
    'Jio anchor investors',
    'Jio valuation',
    'Jio OFS',
    'Jio share price',
    'Jio shareholder quota',
    // Hindi
    'जियो आईपीओ',
    'जियो का आईपीओ',
    'जियो आईपीओ जीएमपी',
    'जियो प्लेटफॉर्म्स',
    'रिलायंस जियो',
    // Gujarati
    'જિયો આઈપીઓ',
    'જિયો IPO',
    'રિલાયન્સ જિયો',
    'જિયો પ્લેટફોર્મ્સ',
    // Hinglish
    'Jio IPO lagau',
    'Jio IPO apply karu',
    'jio ka ipo',
    'jio ipo lena chahiye',
    'jio ipo allotment kab',
  ],
  hashtags: [
    '#JioIPO',
    '#JioPlatformsIPO',
    '#RelianceJioIPO',
    '#JioIPO2026',
    '#JioIPOGMP',
    '#JioGMP',
    '#JioListing',
    '#JioAllotment',
    '#JioIPOAllotment',
    '#JioPlatforms',
    '#RelianceJio',
    '#MukeshAmbani',
    '#AkashAmbani',
    '#IshaAmbani',
  ],
  generic_hashtags: [
    '#IPO',
    '#IPOAlert',
    '#GMP',
    '#StockMarketIndia',
    '#RIL',
    '#Reliance',
    '#RelianceIPO',
    '#Ambani',
  ],
  entities: {
    mukesh: {
      label: 'Mukesh Ambani',
      aliases: [
        'Mukesh Ambani',
        'Mukesh D. Ambani',
        'Mukesh D Ambani',
        'Mukeshbhai',
        'Mukesh bhai',
        'MukeshAmbani',
        'मुकेश अंबानी',
        'મુકેશ અંબાણી',
      ],
    },
    akash: {
      label: 'Akash Ambani',
      aliases: [
        'Akash Ambani',
        'Akash M. Ambani',
        'Akash M Ambani',
        'AkashAmbani',
        'आकाश अंबानी',
        'આકાશ અંબાણી',
      ],
    },
    isha: {
      label: 'Isha Ambani',
      aliases: [
        'Isha Ambani',
        'Isha Ambani Piramal',
        'Isha Piramal',
        'IshaAmbani',
        'ईशा अंबानी',
        'ઈશા અંબાણી',
      ],
    },
    jio: {
      label: 'Jio',
      aliases: [
        'Jio Platforms',
        'Jio Platforms Ltd',
        'Reliance Jio',
        'Reliance Jio Infocomm',
        'RJIL',
        'JioPlatforms',
        'RelianceJio',
        'जियो प्लेटफॉर्म्स',
        'रिलायंस जियो',
        'જિયો પ્લેટફોર્મ્સ',
        'રિલાયન્સ જિયો',
      ],
    },
  },
  anchor_groups: [
    { name: 'jio', terms: ['jio', 'जियो', 'જિયો', 'JPL'] },
    { name: 'reliance', terms: ['Reliance', 'RIL', 'Reliance Industries', 'रिलायंस', 'રિલાયન્સ'] },
    { name: 'ambani', terms: ['Ambani', 'Ambani family', 'अंबानी', 'અંબાણી'] },
  ],
  cooccurrence_terms: [
    // designer list
    'IPO',
    'आईपीओ',
    'આઈપીઓ',
    'GMP',
    'grey market',
    'listing',
    'allotment',
    'subscription',
    'subscribed',
    'price band',
    'DRHP',
    'RHP',
    'anchor',
    'QIB',
    'NII',
    'HNI',
    'retail quota',
    'lot size',
    'kostak',
    'sauda',
    // judge's IPO terms not already above
    'grey market premium',
    'subject to sauda',
    'allotment status',
    'subscription status',
    'subscribed times',
    'shareholder quota',
    'anchor investors',
    'OFS',
    'offer for sale',
    'valuation',
    'listing price',
    'listing gain',
    'listing day',
    'apply or avoid',
    // Hindi, Gujarati and Hinglish IPO terms
    'जीएमपी',
    'ग्रे मार्केट प्रीमियम',
    'अलॉटमेंट',
    'लिस्टिंग',
    'प्राइस बैंड',
    'आईपीओ अलॉटमेंट',
    'ગ્રે માર્કેટ',
    'એલોટમેન્ટ',
    'આઈપીઓ એલોટમેન્ટ',
    'લિસ્ટિંગ',
    'allotment mila',
    'GMP kitna',
    'listing gain kitna',
  ],
  negative_terms: [
    'Jio Financial Services',
    'Jio Financial',
    'JFSL',
    'JFS',
    'Jio Finance',
    'Jio BlackRock',
    'JioBlackRock',
    'JioStar',
    'JioHotstar',
    'JioCinema',
    'JioSaavn',
    'jio aur jeene do',
    'khul ke jio',
    'जियो और जीने दो',
  ],
}

function source(
  key: SourceKey,
  interval_min: number,
  extra: Partial<Omit<SourceConfig, 'lane' | 'interval_min'>> = {},
): SourceConfig {
  return {
    enabled: true,
    lane: SOURCE_DEFAULT_LANE[key],
    interval_min,
    market_hours_interval_min: null,
    coverage_label: 'full_search',
    x_tier: null,
    rate_limits: {},
    creds_ref: null,
    params: {},
    ...extra,
  }
}

const portal = (key: SourceKey) =>
  source(key, 60, { market_hours_interval_min: 10, coverage_label: 'scraped' })

/** Cadence from the design resolutions; all values editable in Settings and Sources. */
const DEFAULT_SOURCES: Record<SourceKey, SourceConfig> = {
  x_api: source('x_api', 2, { x_tier: 'none' }),
  x_apify: source('x_apify', 10, { coverage_label: 'sampled' }),
  youtube: source('youtube', 15, {
    params: { news_channel_ids: [], max_tracked_videos: 20, daily_quota_units: 10000 },
  }),
  reddit: source('reddit', 5, {
    params: {
      subreddits: [
        'IndianStockMarket',
        'IndiaInvestments',
        'StockMarketIndia',
        'IndianStreetBets',
        'india',
        'mumbai',
      ],
    },
  }),
  news_rss: source('news_rss', 5, {
    params: {
      publishers: [
        'Mint',
        'ETMarkets',
        'Moneycontrol',
        'Business Standard',
        'Economic Times',
        'Financial Express',
      ],
      google_news: true,
    },
  }),
  web_search: source('web_search', 15, {
    params: { queries: ['site:instagram.com', 'site:linkedin.com', 'Groww', 'Emkay', 'Centrum'] },
  }),
  apify_instagram: source('apify_instagram', 30, { coverage_label: 'sampled' }),
  apify_linkedin: source('apify_linkedin', 30, { coverage_label: 'sampled' }),
  portal_chittorgarh: portal('portal_chittorgarh'),
  portal_investorgain: portal('portal_investorgain'),
  portal_ipowatch: portal('portal_ipowatch'),
}

export const DEFAULT_CONFIG: AppConfig = {
  terms: DEFAULT_TERMS,
  sources: DEFAULT_SOURCES,
  retention_days: { raw_json: 30, post_text: 90, authors: 90 },
  min_items_for_split: 30,
  active_min_items_24h: 10,
  backfill_days: 7,
  person_level_views: false,
}
