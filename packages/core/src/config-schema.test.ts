import { describe, expect, it } from 'vitest'
import { AppConfig, DEFAULT_CONFIG, SourceConfig, TermsConfig } from './config-schema'
import { SOURCE_DEFAULT_LANE, SOURCE_KEYS } from './types'

const clone = <T>(v: T): T => structuredClone(v)

describe('AppConfig', () => {
  it('round-trips DEFAULT_CONFIG unchanged', () => {
    expect(AppConfig.parse(DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG)
  })

  it('rejects an empty object', () => {
    expect(AppConfig.safeParse({}).success).toBe(false)
  })

  it('fills retention_days defaults for an old row without them', () => {
    const old: Partial<typeof DEFAULT_CONFIG> = clone(DEFAULT_CONFIG)
    delete old.retention_days
    const parsed = AppConfig.parse(old)
    expect(parsed.retention_days).toEqual({ raw_json: 30, post_text: 90, authors: 90 })
  })

  it('fills scalar defaults for an old row', () => {
    const old = { terms: DEFAULT_CONFIG.terms, sources: DEFAULT_CONFIG.sources }
    const parsed = AppConfig.parse(old)
    expect(parsed).toMatchObject({
      min_items_for_split: 30,
      active_min_items_24h: 10,
      backfill_days: 7,
      person_level_views: false,
    })
  })

  it('refuses person_level_views: true', () => {
    const c = { ...clone(DEFAULT_CONFIG), person_level_views: true }
    expect(AppConfig.safeParse(c).success).toBe(false)
  })

  it('refuses raw_json retention longer than post_text', () => {
    const c = clone(DEFAULT_CONFIG)
    c.retention_days = { raw_json: 120, post_text: 90, authors: 90 }
    expect(AppConfig.safeParse(c).success).toBe(false)
  })

  it('refuses interval_min 0 and non-integers', () => {
    const c = clone(DEFAULT_CONFIG)
    c.sources.reddit.interval_min = 0
    expect(AppConfig.safeParse(c).success).toBe(false)
    c.sources.reddit.interval_min = 2.5
    expect(AppConfig.safeParse(c).success).toBe(false)
  })

  it('requires all 11 sources', () => {
    const c = clone(DEFAULT_CONFIG) as { sources: Partial<typeof DEFAULT_CONFIG.sources> }
    delete c.sources.portal_ipowatch
    expect(AppConfig.safeParse(c).success).toBe(false)
  })

  it('refuses an empty string in any term list', () => {
    const lists = [
      'ipo_terms',
      'hashtags',
      'generic_hashtags',
      'cooccurrence_terms',
      'negative_terms',
    ] as const
    for (const list of lists) {
      const t = clone(DEFAULT_CONFIG.terms)
      t[list] = [...t[list], '  ']
      expect(TermsConfig.safeParse(t).success, list).toBe(false)
    }
    const t = clone(DEFAULT_CONFIG.terms)
    t.entities.isha.aliases.push('')
    expect(TermsConfig.safeParse(t).success).toBe(false)
    const g = clone(DEFAULT_CONFIG.terms)
    g.anchor_groups[0]!.terms.push('')
    expect(TermsConfig.safeParse(g).success).toBe(false)
  })

  it('SourceConfig defaults the optional fields', () => {
    expect(SourceConfig.parse({ lane: 'social', interval_min: 5 })).toEqual({
      enabled: true,
      lane: 'social',
      interval_min: 5,
      market_hours_interval_min: null,
      coverage_label: 'full_search',
      x_tier: null,
      rate_limits: {},
      creds_ref: null,
      params: {},
    })
  })
})

describe('DEFAULT_CONFIG.sources cadence (design resolutions)', () => {
  it('matches the resolved table exactly', () => {
    const table = Object.fromEntries(
      SOURCE_KEYS.map((k) => {
        const s = DEFAULT_CONFIG.sources[k]
        return [k, [s.interval_min, s.market_hours_interval_min, s.coverage_label]]
      }),
    )
    expect(table).toEqual({
      x_api: [2, null, 'full_search'],
      x_apify: [10, null, 'sampled'],
      youtube: [15, null, 'full_search'],
      reddit: [5, null, 'full_search'],
      news_rss: [5, null, 'full_search'],
      web_search: [15, null, 'full_search'],
      apify_instagram: [30, null, 'sampled'],
      apify_linkedin: [30, null, 'sampled'],
      portal_chittorgarh: [60, 10, 'scraped'],
      portal_investorgain: [60, 10, 'scraped'],
      portal_ipowatch: [60, 10, 'scraped'],
    })
  })

  it('enables every source, in its default lane', () => {
    for (const k of SOURCE_KEYS) {
      expect(DEFAULT_CONFIG.sources[k].enabled, k).toBe(true)
      expect(DEFAULT_CONFIG.sources[k].lane, k).toBe(SOURCE_DEFAULT_LANE[k])
      expect(DEFAULT_CONFIG.sources[k].creds_ref, k).toBeNull()
    }
  })

  it('sets x_tier none on x_api only', () => {
    expect(DEFAULT_CONFIG.sources.x_api.x_tier).toBe('none')
    for (const k of SOURCE_KEYS.filter((k) => k !== 'x_api')) {
      expect(DEFAULT_CONFIG.sources[k].x_tier, k).toBeNull()
    }
  })

  it('carries per-source params', () => {
    expect(DEFAULT_CONFIG.sources.reddit.params.subreddits).toEqual([
      'IndianStockMarket',
      'IndiaInvestments',
      'StockMarketIndia',
      'IndianStreetBets',
      'india',
      'mumbai',
    ])
    expect(DEFAULT_CONFIG.sources.news_rss.params).toEqual({
      publishers: [
        'Mint',
        'ETMarkets',
        'Moneycontrol',
        'Business Standard',
        'Economic Times',
        'Financial Express',
      ],
      google_news: true,
    })
    expect(DEFAULT_CONFIG.sources.web_search.params.queries).toEqual([
      'site:instagram.com',
      'site:linkedin.com',
      'Groww',
      'Emkay',
      'Centrum',
    ])
    expect(DEFAULT_CONFIG.sources.youtube.params).toEqual({
      news_channel_ids: [],
      max_tracked_videos: 20,
      daily_quota_units: 10000,
    })
  })

  it('has the resolved scalar values', () => {
    expect(DEFAULT_CONFIG).toMatchObject({
      retention_days: { raw_json: 30, post_text: 90, authors: 90 },
      min_items_for_split: 30,
      active_min_items_24h: 10,
      backfill_days: 7,
      person_level_views: false,
    })
  })
})

describe('DEFAULT_CONFIG.terms', () => {
  const t = DEFAULT_CONFIG.terms
  const AMBIGUOUS = ['jio', 'जियो', 'જિયો', 'reliance', 'ril', 'ambani', 'अंबानी', 'અંબાણી']

  it('keeps bare ambiguous tokens out of every list that matches alone or qualifies', () => {
    const lists: Record<string, string[]> = {
      ipo_terms: t.ipo_terms,
      cooccurrence_terms: t.cooccurrence_terms,
      ...Object.fromEntries(Object.entries(t.entities).map(([k, e]) => [`entity:${k}`, e.aliases])),
    }
    for (const [name, list] of Object.entries(lists)) {
      for (const term of list) {
        expect(AMBIGUOUS, `${name}: ${term}`).not.toContain(term.trim().toLowerCase())
      }
    }
  })

  it('puts the bare ambiguous tokens in anchor groups instead', () => {
    const anchors = t.anchor_groups.flatMap((g) => g.terms.map((x) => x.toLowerCase()))
    for (const a of AMBIGUOUS) expect(anchors, a).toContain(a)
    expect(t.anchor_groups.map((g) => g.name)).toEqual(['jio', 'reliance', 'ambani'])
  })

  it('has no case-insensitive duplicates within a list', () => {
    const lists: string[][] = [
      t.ipo_terms,
      t.hashtags,
      t.generic_hashtags,
      t.cooccurrence_terms,
      t.negative_terms,
      ...Object.values(t.entities).map((e) => e.aliases),
      ...t.anchor_groups.map((g) => g.terms),
    ]
    for (const list of lists) {
      const lower = list.map((x) => x.toLowerCase())
      expect(new Set(lower).size, list.join(', ')).toBe(lower.length)
    }
  })

  it('holds the 28 English company and IPO phrases plus the regional strong terms', () => {
    expect(t.ipo_terms.slice(0, 28)).toEqual([
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
    ])
    for (const x of [
      'जियो आईपीओ',
      'जियो का आईपीओ',
      'जियो आईपीओ जीएमपी',
      'जियो प्लेटफॉर्म्स',
      'रिलायंस जियो',
      'જિયો આઈપીઓ',
      'જિયો IPO',
      'રિલાયન્સ જિયો',
      'જિયો પ્લેટફોર્મ્સ',
      'Jio IPO lagau',
      'Jio IPO apply karu',
      'jio ka ipo',
      'jio ipo lena chahiye',
      'jio ipo allotment kab',
    ]) {
      expect(t.ipo_terms, x).toContain(x)
    }
    expect(t.ipo_terms).toHaveLength(42)
  })

  it('splits Jio-specific hashtags from generic qualifier hashtags', () => {
    expect(t.hashtags).toHaveLength(14)
    expect(t.hashtags).toContain('#JioIPO')
    expect(t.hashtags).toContain('#IshaAmbani')
    expect(t.generic_hashtags).toEqual([
      '#IPO',
      '#IPOAlert',
      '#GMP',
      '#StockMarketIndia',
      '#RIL',
      '#Reliance',
      '#RelianceIPO',
      '#Ambani',
    ])
    for (const h of [...t.hashtags, ...t.generic_hashtags]) expect(h.startsWith('#'), h).toBe(true)
  })

  it('has entity aliases in English, Hindi and Gujarati', () => {
    expect(t.entities.mukesh.aliases).toContain('Mukesh Ambani')
    expect(t.entities.mukesh.aliases).toContain('मुकेश अंबानी')
    expect(t.entities.akash.aliases).toContain('આકાશ અંબાણી')
    expect(t.entities.isha.aliases).toContain('Isha Piramal')
    expect(t.entities.jio.aliases).toContain('RJIL')
    expect(t.entities.jio.aliases).toHaveLength(11)
  })

  it('has the co-occurrence and negative lists', () => {
    for (const x of ['IPO', 'आईपीओ', 'આઈપીઓ', 'GMP', 'sauda', 'apply or avoid', 'GMP kitna'])
      expect(t.cooccurrence_terms, x).toContain(x)
    expect(t.cooccurrence_terms).toHaveLength(47)
    expect(t.negative_terms).toEqual([
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
    ])
  })
})
