import { describe, expect, it } from 'vitest'
import { resolveTrustConfig, TRUST_DEFAULTS, TrustConfig } from './config'

describe('TRUST_DEFAULTS', () => {
  it('parses against the TrustConfig schema', () => {
    expect(TrustConfig.parse(TRUST_DEFAULTS)).toEqual(TRUST_DEFAULTS)
  })

  it('holds the reach and coordination thresholds from the plan', () => {
    expect(TRUST_DEFAULTS.reach).toMatchObject({
      percentile: 0.95,
      lookbackDays: 7,
      mediaOutletWeight: 0.6,
      floor: 0.05,
      unknownScore: 0.25,
      minSamplesForPercentile: 20,
      fullRescoreEveryMin: 60,
    })
    expect(TRUST_DEFAULTS.reach.defaultP95Log).toEqual({
      x_api: 5,
      x_apify: 5,
      apify_linkedin: 4,
      apify_instagram: 4,
      youtube: 5,
      reddit: 3,
    })
    expect(TRUST_DEFAULTS.coordination).toEqual({
      nearDupMinAuthors: 5,
      nearDupWindowMin: 60,
      burstMultiplier: 4,
      burstMinItems: 10,
      top5ShareThreshold: 0.4,
      top5MinItems: 30,
    })
  })
})

describe('resolveTrustConfig', () => {
  it('returns the defaults when the app config has no trust block', () => {
    expect(resolveTrustConfig({ min_items_for_split: 30 })).toEqual(TRUST_DEFAULTS)
    expect(resolveTrustConfig(undefined)).toEqual(TRUST_DEFAULTS)
    expect(resolveTrustConfig(null)).toEqual(TRUST_DEFAULTS)
  })

  it('deep-merges a partial trust block over the defaults', () => {
    const cfg = resolveTrustConfig({
      trust: {
        reach: { floor: 0.1, defaultP95Log: { reddit: 2 } },
        coordination: { burstMinItems: 20 },
      },
    })
    expect(cfg.reach.floor).toBe(0.1)
    expect(cfg.reach.unknownScore).toBe(0.25)
    expect(cfg.reach.defaultP95Log).toMatchObject({ reddit: 2, x_api: 5, youtube: 5 })
    expect(cfg.coordination.burstMinItems).toBe(20)
    expect(cfg.coordination.nearDupMinAuthors).toBe(5)
  })

  it('falls back to the defaults when the merged config does not parse', () => {
    expect(resolveTrustConfig({ trust: { reach: { floor: 'high' } } })).toEqual(TRUST_DEFAULTS)
    expect(resolveTrustConfig({ trust: { reach: { percentile: 2 } } })).toEqual(TRUST_DEFAULTS)
    expect(resolveTrustConfig({ trust: 'nope' })).toEqual(TRUST_DEFAULTS)
  })

  it('never hands out the shared defaults object', () => {
    const cfg = resolveTrustConfig({})
    cfg.reach.defaultP95Log.x_api = 99
    expect(TRUST_DEFAULTS.reach.defaultP95Log.x_api).toBe(5)
  })
})
