// Local backend over the scraped snapshot. Implements the same response shapes and rules as the real route handlers
// (packages/core/src/api-types.ts, apps/web/src/lib/queries/*): 24h windows, the 30-item split
// rule, 10-item active threshold, sqrt(items x authors) x velocity ranking, the 10% trend rule,
// IST-hour sparklines, and the author privacy rule. State lives in memory for the session.
;(function () {
  const { compileMatcher, DEFAULT_TERMS, SEED_TOPICS } = window.JioCore
  const DATA = window.SNAPSHOT_DATA

  const MIN = 60_000
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR
  // The real app needs 30 posts to show a split; the mock's real-data volume is lower, so it uses 20.
  const MIN_FOR_SPLIT = 20
  const ACTIVE_MIN = 10
  const LOADED_AT = Date.now()

  // -------------------------------------------------------------------------------------------
  // Store

  const subs = new Set()
  const store = {
    subscribe(fn) {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    emit() {
      subs.forEach((fn) => fn())
    },
  }

  const SOURCE_LABEL = {
    x_api: 'X (official API)', x_apify: 'X (Apify)', youtube: 'YouTube', reddit: 'Reddit', news_rss: 'News RSS',
    web_search: 'Web search', apify_instagram: 'Instagram (Apify)', apify_linkedin: 'LinkedIn (Apify)',
    portal_chittorgarh: 'Chittorgarh', portal_investorgain: 'InvestorGain', portal_ipowatch: 'IPO Watch',
  }
  const SOURCE_KEYS = Object.keys(SOURCE_LABEL)
  const AUTHOR_LABEL = {
    x_api: 'X user', x_apify: 'X user', youtube: 'YouTube user', reddit: 'Reddit user', news_rss: 'News source',
    web_search: 'Web result', apify_instagram: 'Instagram user', apify_linkedin: 'LinkedIn user',
    portal_chittorgarh: 'IPO portal', portal_investorgain: 'IPO portal', portal_ipowatch: 'IPO portal',
  }

  // Posts with absolute times (the snapshot's "minutes before the run's until time", resolved at load).
  const posts = DATA.posts.map((p) => ({
    id: p.id,
    sourceKey: p.s,
    at: LOADED_AT - p.m * MIN,
    url: p.u,
    text: p.t,
    glossEn: p.g,
    lang: p.l,
    topic: p.tp,
    sentiment: p.se,
    entities: p.e,
    confidence: p.c,
    reachScore: p.r,
    reachRaw: p.rr,
    author: p.a === null ? null : DATA.authors[p.a],
    lane: p.ln,
    coordinated: !!p.co,
    cluster: null,
    origin: 'model',
  }))
  const byId = new Map(posts.map((p) => [p.id, p]))

  // Topics: seeds from @jio/core seed-topics.ts. No summaries until a real summariser runs.
  let topics = SEED_TOPICS.map((t) => ({
    ...t,
    status: 'active',
    summary2line: null,
    summaryAt: null,
  }))
  const topicBySlug = (slug) => topics.find((t) => t.slug === slug)

  // No clustering step has run on the snapshot, so there are no Emerging candidates.
  let emergingCandidates = []

  // Config (versioned, like config_versions)
  let config = {
    version: 1,
    savedAt: LOADED_AT,
    terms: structuredClone(DEFAULT_TERMS),
    retention: { raw_json: 30, post_text: 90, authors: 90 },
    min_items_for_split: MIN_FOR_SPLIT,
    active_min_items_24h: ACTIVE_MIN,
  }

  // Only actions taken in this session are logged.
  const audit = []
  const logEvent = (kind, detail) => audit.unshift({ at: Date.now(), kind, ip: '-', detail })

  // -------------------------------------------------------------------------------------------
  // Slicing helpers

  const nowMs = () => Date.now()
  const LEADERSHIP = ['mukesh', 'akash', 'isha']
  const matchesEntity = (p, e) => e === 'all' || (e === 'leadership' ? p.entities.some((x) => LEADERSHIP.includes(x)) : p.entities.includes(e))
  const inFilters = (p, f) => matchesEntity(p, f.entity) && (f.lane === 'all' || p.lane === f.lane)
  const split = (list) => {
    const c = { items: list.length, pos: 0, neu: 0, neg: 0 }
    for (const p of list) c[p.sentiment === 'positive' ? 'pos' : p.sentiment === 'negative' ? 'neg' : 'neu']++
    return { ...c, splitShown: c.items >= config.min_items_for_split }
  }
  const round1 = (n) => Math.round(n * 10) / 10
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
  function trendOf(cur, prev) {
    if (prev === 0) return { trend: cur > 0 ? 'new' : 'flat', deltaPct: null }
    const deltaPct = round1(((cur - prev) / prev) * 100)
    return { trend: deltaPct >= 10 ? 'up' : deltaPct <= -10 ? 'down' : 'flat', deltaPct }
  }
  const rankScore = (items, prev, authors) => Math.sqrt(items * authors) * clamp((items + 1) / (prev + 1), 0.5, 3)
  const lowConfPct = (list) => (list.length ? round1((list.filter((p) => p.confidence === 'low').length / list.length) * 100) : 0)
  const uniqueAuthors = (list) => new Set(list.map((p) => (p.author ? JSON.stringify(p.author) : p.id))).size

  /** Start of the IST hour containing t (IST is UTC+5:30, so hours start at :30 UTC). */
  const istHourStart = (t) => {
    const shifted = t + 5.5 * HOUR
    return shifted - (shifted % HOUR) - 5.5 * HOUR
  }

  // -------------------------------------------------------------------------------------------
  // Sources (config + health)

  // Per-source facts come from the scraped-output manifest and envelopes. Poll intervals, quotas and
  // X tier settings are not part of that data, so none are shown.
  const COVERAGE_OF = {
    x_api: 'full_search', x_apify: 'sampled', youtube: 'full_search', reddit: 'full_search', news_rss: 'full_search',
    web_search: 'full_search', apify_instagram: 'sampled', apify_linkedin: 'sampled',
    portal_chittorgarh: 'scraped', portal_investorgain: 'scraped', portal_ipowatch: 'scraped',
  }
  const SOURCES = Object.fromEntries(
    SOURCE_KEYS.map((key) => {
      const s = (DATA.sources ?? []).find((x) => x.sourceKey === key)
      return [key, {
        coverage: COVERAGE_OF[key],
        status: s?.status ?? 'none',
        error: s?.error ?? null,
        cost: s?.costUsd ?? 0,
        total: s?.posts ?? 0,
        runAt: s && s.fetchedMinutesAgo != null ? LOADED_AT - s.fetchedMinutesAgo * MIN : null,
      }]
    }),
  )

  const lane = (key) => (['news_rss', 'web_search', 'portal_chittorgarh', 'portal_investorgain', 'portal_ipowatch'].includes(key) ? 'media' : 'social')

  function sourceRows() {
    const now = nowMs()
    const since = now - DAY
    return SOURCE_KEYS.map((key) => {
      const s = SOURCES[key]
      const ran = s.runAt !== null && s.status !== 'skipped' && s.status !== 'none'
      return {
        sourceKey: key,
        label: SOURCE_LABEL[key],
        lane: lane(key),
        enabled: ran,
        status: s.status,
        lastRunAt: s.runAt ? new Date(s.runAt).toISOString() : null,
        ageMin: s.runAt ? Math.max(0, (now - s.runAt) / MIN) : null,
        lastError: s.error,
        itemsTotal: s.total,
        items24h: posts.filter((p) => p.sourceKey === key && p.at >= since).length,
        spendUsd: s.cost,
        coverage: s.coverage,
      }
    })
  }

  /** One run per source: the scrape that produced the snapshot. */
  function sourceRuns(key) {
    const s = SOURCES[key]
    if (!s.runAt) return []
    return [{ at: new Date(s.runAt).toISOString(), status: s.status, itemsNew: s.total, costUsd: s.cost, error: s.error }]
  }

  function freshness() {
    return sourceRows().map((r) => ({
      sourceKey: r.sourceKey,
      lane: r.lane,
      enabled: r.enabled,
      intervalMin: 0,
      lastSuccessAt: r.lastRunAt,
      ageMin: r.ageMin,
      consecutiveFailures: 0,
      status: 'ok',
    }))
  }

  // -------------------------------------------------------------------------------------------
  // Market

  const market = DATA.market.map((m) => ({ ...m, at: LOADED_AT - m.m * MIN }))
  function marketStrip() {
    const now = nowMs()
    const latest = new Map()
    for (const m of market) {
      const cur = latest.get(m.series)
      if (!cur || m.at > cur.at) latest.set(m.series, m)
    }
    return {
      unofficial: true,
      items: [...latest.values()].map((m) => {
        const ageMin = (now - m.at) / MIN
        return { series: m.series, value: m.value, observedAt: new Date(m.at).toISOString(), sourceKey: m.sourceKey, sourceUrl: m.sourceUrl, ageMin, stale: ageMin > 90 }
      }),
    }
  }

  // -------------------------------------------------------------------------------------------
  // GET /api/brief

  function getBrief(filters) {
    const now = nowMs()
    const cur = posts.filter((p) => p.at >= now - DAY && p.at <= now && inFilters(p, filters))
    const prev = posts.filter((p) => p.at >= now - 2 * DAY && p.at < now - DAY && inFilters(p, filters))
    const kpiSplit = split(cur)
    const hourNow = istHourStart(now)

    const rows = topics
      .filter((t) => t.kind === 'seed' && t.status === 'active')
      .map((t) => {
        const list = cur.filter((p) => p.topic === t.slug)
        const prevN = prev.filter((p) => p.topic === t.slug).length
        const authors = uniqueAuthors(list)
        const spark = Array.from({ length: 24 }, (_, i) => {
          const start = hourNow - (23 - i) * HOUR
          return list.filter((p) => p.at >= start && p.at < start + HOUR).length
        })
        return {
          ...split(list),
          slug: t.slug,
          name: t.name,
          summary2line: t.summary2line,
          summaryAt: t.summaryAt ? new Date(t.summaryAt).toISOString() : null,
          itemsPrev24h: prevN,
          uniqueAuthors24h: authors,
          score: rankScore(list.length, prevN, authors),
          ...trendOf(list.length, prevN),
          lowConfPct: lowConfPct(list),
          suspectedCoordinated: list.filter((p) => p.coordinated).length,
          spark,
        }
      })
      .filter((r) => r.items >= config.active_min_items_24h)
      .sort((a, b) => b.score - a.score || b.items - a.items || a.name.localeCompare(b.name))

    const emergingPosts = cur.filter((p) => p.topic === 'emerging')
    return {
      asOf: new Date(now).toISOString(),
      minItemsForSplit: config.min_items_for_split,
      activeMinItems: config.active_min_items_24h,
      kpis: {
        items24h: cur.length,
        itemsPrev24h: prev.length,
        pos: kpiSplit.pos,
        neu: kpiSplit.neu,
        neg: kpiSplit.neg,
        splitShown: kpiSplit.splitShown,
        lowConfPct: lowConfPct(cur),
        suspectedCoordinated: cur.filter((p) => p.coordinated).length,
      },
      topics: rows,
      emerging: { count: emergingPosts.length, candidates: new Set(emergingPosts.map((p) => p.cluster)).size },
      unclassified: { count: cur.filter((p) => p.topic === 'unclassified').length },
      market: marketStrip(),
      freshness: freshness(),
    }
  }

  /** Positive / neutral / negative counts per IST calendar day for the last 7 days, oldest first. */
  function getSentimentTrend(filters) {
    const IST_OFFSET = 330 * MIN
    const now = nowMs()
    const todayStart = Math.floor((now + IST_OFFSET) / DAY) * DAY - IST_OFFSET
    return Array.from({ length: 7 }, (_, i) => {
      const from = todayStart - (6 - i) * DAY
      const to = i === 6 ? now : from + DAY
      const c = split(posts.filter((p) => p.at >= from && p.at < to && inFilters(p, filters)))
      return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), ...c }
    })
  }

  /** Talking-point board: every seed topic with at least BOARD_MIN posts in the last 7 days, judged
   *  on the week (24h alone is too thin for the real snapshot). Momentum still compares the last 24h
   *  with the 24h before. */
  const BOARD_MIN = 5
  function getBoard(filters) {
    const now = nowMs()
    const week = posts.filter((p) => p.at >= now - 7 * DAY && p.at <= now && inFilters(p, filters))
    return topics
      .filter((t) => t.kind === 'seed' && t.status === 'active')
      .map((t) => {
        const list = week.filter((p) => p.topic === t.slug)
        const cur = list.filter((p) => p.at >= now - DAY).length
        const prev = list.filter((p) => p.at >= now - 2 * DAY && p.at < now - DAY).length
        const c = split(list)
        return {
          ...c,
          splitShown: c.items >= 10,
          slug: t.slug,
          name: t.name,
          items24h: cur,
          ...trendOf(cur, prev),
          suspectedCoordinated: list.filter((p) => p.coordinated).length,
        }
      })
      .filter((r) => r.items >= BOARD_MIN)
      .sort((a, b) => b.items - a.items)
  }

  /** Positive / neutral / negative counts per block of `blockHours` IST hours since midnight today, oldest first. */
  function getSentimentToday(filters, blockHours = 3) {
    const IST_OFFSET = 330 * MIN
    const now = nowMs()
    const todayStart = Math.floor((now + IST_OFFSET) / DAY) * DAY - IST_OFFSET
    const BLOCK = blockHours * HOUR
    const blocks = Math.floor((now - todayStart) / BLOCK) + 1
    return Array.from({ length: blocks }, (_, i) => {
      const from = todayStart + i * BLOCK
      const to = Math.min(now, from + BLOCK)
      const c = split(posts.filter((p) => p.at >= from && p.at < to && inFilters(p, filters)))
      return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), ...c }
    })
  }

  /** GMP points (IPO Watch) over the last 7 days, oldest first, for the brief's grey-market card. */
  function getGmpHistory() {
    const since = nowMs() - 7 * DAY
    return market
      .filter((m) => m.series === 'gmp_inr' && m.sourceKey === 'portal_ipowatch' && m.at >= since)
      .sort((a, b) => a.at - b.at)
      .map((m) => ({ t: m.at, v: m.value }))
  }

  // -------------------------------------------------------------------------------------------
  // GET /api/topics/:slug/timeline

  const COVERAGE_LABEL = { full_search: 'full search', sampled: 'sampled', scraped: 'scraped' }

  function getTimeline(slug, filters) {
    const t = topicBySlug(slug)
    if (!t) return null
    const now = nowMs()
    const hourNow = istHourStart(now)
    const start = hourNow - 167 * HOUR
    const all = posts.filter((p) => p.topic === slug && inFilters(p, filters))
    const week = all.filter((p) => p.at >= start)
    const day = all.filter((p) => p.at >= now - DAY)
    const series = Array.from({ length: 168 }, (_, i) => {
      const hs = start + i * HOUR
      const list = week.filter((p) => p.at >= hs && p.at < hs + HOUR)
      const c = split(list)
      return { hourStart: new Date(hs).toISOString(), items: c.items, pos: c.pos, neu: c.neu, neg: c.neg, lowConf: list.filter((p) => p.confidence === 'low').length }
    })
    const marketSeries = { gmp_inr: [], sub_retail_x: [], sub_nii_x: [], sub_qib_x: [], sub_total_x: [] }
    for (const m of market.filter((m) => m.at >= start && m.sourceKey === 'portal_ipowatch').sort((a, b) => a.at - b.at)) {
      marketSeries[m.series].push({ t: new Date(m.at).toISOString(), v: m.value })
    }
    const bySource = SOURCE_KEYS.map((key) => ({ sourceKey: key, coverageLabel: COVERAGE_LABEL[SOURCES[key].coverage], ...split(day.filter((p) => p.sourceKey === key)) })).filter((r) => r.items > 0)
    const byEntity = ['leadership', 'jio'].map((entity) => ({ entity, ...split(day.filter((p) => matchesEntity(p, entity))) }))

    // Coordination (06-02): near-duplicate clusters, burst buckets, top-author share.
    const coordPosts = week.filter((p) => p.coordinated)
    const clusters = coordPosts.length
      ? [{
          clusterId: 'nd-7f3a',
          posts: coordPosts.length,
          authors: coordPosts.length,
          firstAt: new Date(Math.min(...coordPosts.map((p) => p.at))).toISOString(),
          lastAt: new Date(Math.max(...coordPosts.map((p) => p.at))).toISOString(),
          sample: coordPosts[0].text,
        }]
      : []
    const bursts = series
      .map((h, i) => ({ h, i }))
      .filter(({ h, i }) => {
        const prior = series.slice(Math.max(0, i - 24), i)
        const avg = prior.reduce((a, x) => a + x.items, 0) / Math.max(1, prior.length)
        return i > 24 && h.items >= 6 && h.items >= 3 * Math.max(1, avg)
      })
      .slice(-3)
      .map(({ h }) => ({ bucketStart: h.hourStart, items: h.items }))
    const counts = new Map()
    for (const p of day) if (p.author) counts.set(JSON.stringify(p.author), (counts.get(JSON.stringify(p.author)) ?? 0) + 1)
    const top5 = [...counts.values()].sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0)

    return {
      topic: {
        slug: t.slug,
        name: t.name,
        kind: t.kind,
        summary2line: t.summary2line,
        summaryAt: t.summaryAt ? new Date(t.summaryAt).toISOString() : null,
        items24h: day.length,
        lastItemAt: all.length ? new Date(Math.max(...all.map((p) => p.at))).toISOString() : null,
      },
      asOf: new Date(now).toISOString(),
      minItemsForSplit: config.min_items_for_split,
      series,
      market: marketSeries,
      bySource: bySource.sort((a, b) => b.items - a.items),
      byEntity,
      coordination: { clusters, bursts, top5AuthorShare: day.length ? top5 / day.length : null },
    }
  }

  // -------------------------------------------------------------------------------------------
  // GET /api/evidence

  const PAGE = 20
  function evidenceAuthor(p) {
    const a = p.author
    if (a && (a.kind === 'media_outlet' || a.kind === 'public_figure')) {
      return { visible: true, kind: a.kind, displayName: a.displayName ?? null, handle: a.handle ?? null }
    }
    return { visible: false, label: AUTHOR_LABEL[p.sourceKey] ?? 'User' }
  }
  function toItem(p) {
    return {
      postId: p.id, sourceKey: p.sourceKey, lane: p.lane, url: p.url, publishedAt: new Date(p.at).toISOString(),
      text: p.text, glossEn: p.glossEn, lang: p.lang, reachScore: p.reachScore, reachRaw: p.reachRaw,
      sentiment: p.sentiment, topicSlug: p.topic, entities: p.entities, confidence: p.confidence, origin: p.origin,
      author: evidenceAuthor(p), suspectedCoordinated: p.coordinated,
    }
  }
  function getEvidence(q) {
    const now = nowMs()
    const from = q.from ? new Date(q.from).getTime() : now - (q.window === '7d' ? 7 * DAY : DAY)
    const to = q.to ? new Date(q.to).getTime() : now
    let list = posts.filter(
      (p) =>
        p.at >= from && p.at < to &&
        inFilters(p, { entity: q.entity ?? 'all', lane: q.lane ?? 'all' }) &&
        (!q.topic || p.topic === q.topic) &&
        (!q.sentiment || p.sentiment === q.sentiment) &&
        (!q.source || p.sourceKey === q.source) &&
        (!q.confidence || p.confidence === q.confidence) &&
        (!q.coordinated || p.coordinated) &&
        (!q.cluster || p.cluster === q.cluster),
    )
    list = list.sort((a, b) => (q.sort === 'newest' ? b.at - a.at : b.reachScore - a.reachScore || b.at - a.at))
    const offset = Number(q.cursor ?? 0)
    const limit = q.limit ?? PAGE
    const page = list.slice(offset, offset + limit)
    return { items: page.map(toItem), nextCursor: offset + limit < list.length ? String(offset + limit) : null, total: list.length }
  }

  // -------------------------------------------------------------------------------------------
  // POST /api/labels (corrections and gold), DELETE for undo

  let labelSeq = 1
  const undoStack = new Map()
  let correctionsCount = 0
  function relabel(postId, next) {
    const p = byId.get(postId)
    if (!p) throw new Error('not found')
    const prev = { sentiment: p.sentiment, topic: p.topic, entities: p.entities, origin: p.origin }
    Object.assign(p, { sentiment: next.sentiment, topic: next.topicSlug, entities: next.entities, origin: 'correction' })
    const classificationId = `c${labelSeq++}`
    undoStack.set(classificationId, { postId, prev })
    correctionsCount++
    logEvent('relabel', `Post ${postId}: ${prev.sentiment} -> ${next.sentiment}${prev.topic !== next.topicSlug ? `, topic ${next.topicSlug}` : ''}`)
    store.emit()
    return { ok: true, classificationId }
  }
  function undoLabel(classificationId) {
    const u = undoStack.get(classificationId)
    if (!u) return
    Object.assign(byId.get(u.postId), u.prev)
    undoStack.delete(classificationId)
    correctionsCount--
    store.emit()
  }

  // -------------------------------------------------------------------------------------------
  // Config: GET/PATCH /api/config, POST test-terms

  const BARE_JIO = ['jio', 'जियो', 'જિયો']
  function validateTerms(terms) {
    const errors = {}
    const lists = { ipo_terms: terms.ipo_terms, hashtags: terms.hashtags, cooccurrence_terms: terms.cooccurrence_terms, negative_terms: terms.negative_terms }
    for (const [k, v] of Object.entries(terms.entities)) lists[`entity:${k}`] = v.aliases
    const neg = new Set(terms.negative_terms.map((t) => t.toLowerCase()))
    for (const [key, list] of Object.entries(lists)) {
      for (const t of list) {
        if (key !== 'negative_terms' && BARE_JIO.includes(t.trim().toLowerCase())) errors[key] = `"${t}" alone is too broad ('jio' also means 'live'): add an IPO word or use an anchor group`
        else if (key !== 'negative_terms' && neg.has(t.toLowerCase())) errors[key] = `"${t}" is also a negative term`
        else if (t.length > 100) errors[key] = 'Terms are at most 100 characters'
      }
    }
    return errors
  }
  function saveTerms(terms, baseVersion) {
    if (baseVersion !== config.version) return { ok: false, status: 409 }
    const errors = validateTerms(terms)
    if (Object.keys(errors).length) return { ok: false, status: 400, errors }
    config = { ...config, terms: structuredClone(terms), version: config.version + 1, savedAt: nowMs() }
    logEvent('config_change', `Config v${config.version}: keyword lists updated`)
    store.emit()
    return { ok: true, version: config.version }
  }
  function testTerms(draft) {
    const now = nowMs()
    const day = posts.filter((p) => p.at >= now - DAY)
    const cur = compileMatcher(config.terms)
    const next = compileMatcher(draft)
    const curHits = day.filter((p) => cur(p.text).relevant)
    const nextHits = day.filter((p) => next(p.text).relevant)
    const added = nextHits.filter((p) => !cur(p.text).relevant).slice(0, 3)
    return { current: curHits.length, draft: nextHits.length, total: day.length, samples: (added.length ? added : nextHits.slice(0, 3)).map((p) => p.text) }
  }
  function saveSettings(patch, baseVersion) {
    if (baseVersion !== config.version) return { ok: false, status: 409 }
    if (patch.retention && patch.retention.raw_json > patch.retention.post_text) {
      return { ok: false, status: 400, errors: { raw_json: 'raw_json retention cannot exceed post_text retention' } }
    }
    config = { ...config, ...patch, version: config.version + 1, savedAt: nowMs() }
    logEvent('config_change', `Config v${config.version}: retention and thresholds`)
    store.emit()
    return { ok: true, version: config.version }
  }
  // -------------------------------------------------------------------------------------------
  // Topics: edit seeds, promote / merge / dismiss Emerging

  function getTopicsAdmin() {
    const now = nowMs()
    const day = posts.filter((p) => p.at >= now - DAY)
    return {
      seeds: topics.filter((t) => t.kind === 'seed' && t.status === 'active'),
      emerging: emergingCandidates
        .filter((c) => c.status === 'candidate')
        .map((c) => {
          const list = posts.filter((p) => p.cluster === c.id && p.topic === 'emerging')
          const distinct = list.filter((p, i) => list.findIndex((q) => q.text === p.text) === i)
          return { ...c, items: list.length, samples: distinct.slice(0, 3).map(toItem) }
        })
        .filter((c) => c.items > 0),
      unclassified24h: day.filter((p) => p.topic === 'unclassified').length,
    }
  }
  function updateTopic(slug, patch) {
    topics = topics.map((t) => (t.slug === slug ? { ...t, ...patch } : t))
    logEvent('config_change', `Topic "${patch.name ?? slug}" edited`)
    store.emit()
  }
  function promote(id, name) {
    const c = emergingCandidates.find((x) => x.id === id)
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
    topics = [...topics, { slug, name, kind: 'seed', status: 'active', description: `Promoted from Emerging: ${c.name}`, examplePhrases: [], summary2line: `New talking point promoted from Emerging candidates.`, summaryAt: nowMs() }]
    for (const p of posts) if (p.cluster === id && p.topic === 'emerging') p.topic = slug
    c.status = 'promoted'
    // A promoted topic needs 10 items in 24h to be active; the demo lowers nothing, so tell the user.
    logEvent('promote_topic', `Promoted "${c.name}" as "${name}"`)
    store.emit()
    return slug
  }
  function merge(id, slug) {
    const c = emergingCandidates.find((x) => x.id === id)
    for (const p of posts) if (p.cluster === id && p.topic === 'emerging') p.topic = slug
    c.status = 'merged'
    logEvent('promote_topic', `Merged "${c.name}" into ${topicBySlug(slug)?.name}`)
    store.emit()
  }
  function dismiss(id) {
    const c = emergingCandidates.find((x) => x.id === id)
    c.status = 'dismissed'
    logEvent('promote_topic', `Dismissed "${c.name}"`)
    store.emit()
  }

  // -------------------------------------------------------------------------------------------
  // Accuracy and the gold queue

  // The gold set starts empty: nothing is labelled until a person labels posts here. Figures are
  // computed from those labels against the classifier's output for the same posts.
  const gold = { labelled: 0, byLang: {}, promptVersion: 'stub classifier (rules)', labels: [], skipped: new Set(), done: new Set() }
  const LANG_NAME = { en: 'EN', hinglish: 'Hinglish', hi: 'Hindi', gu: 'Gujarati' }
  function computeAccuracy() {
    const L = gold.labels
    const rate = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : null)
    const SENT = ['negative', 'neutral', 'positive']
    const confusion = SENT.map((g) => SENT.map((m) => L.filter((x) => x.gold.sentiment === g && x.model.sentiment === m).length))
    const sarcastic = L.filter((x) => x.gold.sarcastic)
    return {
      overall: { sentiment: rate(L, (x) => x.gold.sentiment === x.model.sentiment), topic: rate(L, (x) => x.gold.topicSlug === x.model.topic) },
      byLang: Object.keys(gold.byLang).map((lang) => {
        const xs = L.filter((x) => x.lang === lang)
        return { lang, label: LANG_NAME[lang] ?? lang, n: xs.length, sentiment: rate(xs, (x) => x.gold.sentiment === x.model.sentiment), topic: rate(xs, (x) => x.gold.topicSlug === x.model.topic) }
      }),
      confusion,
      sarcasm: { n: sarcastic.length, sentiment: rate(sarcastic, (x) => x.gold.sentiment === x.model.sentiment) },
    }
  }
  function getAccuracy() {
    const measured = gold.labelled >= 200
    const m = measured ? computeAccuracy() : null
    return {
      measured,
      labelled: gold.labelled,
      target: 200,
      byLangCounts: gold.byLang,
      promptVersion: gold.promptVersion,
      promptAt: null,
      overall: m ? m.overall : null,
      byLang: m ? m.byLang : null,
      confusion: m ? m.confusion : null,
      sarcasm: m ? m.sarcasm : null,
      corrections: { total: correctionsCount, fewShot: Math.min(20, correctionsCount) },
    }
  }
  function goldQueueItem() {
    if (gold.labelled >= 200) return null
    const candidates = posts.filter((p) => p.lang !== 'en' && p.topic !== 'unclassified' && !gold.done.has(p.id) && !gold.skipped.has(p.id) && p.sourceKey !== 'news_rss')
    const p = candidates[(gold.labelled * 7 + gold.skipped.size * 13) % candidates.length]
    return p ? toItem(p) : null
  }
  function saveGold(postId, label) {
    if (gold.labelled >= 200) return { ok: false, status: 409 }
    const p = byId.get(postId)
    gold.done.add(postId)
    gold.labels.push({ lang: p.lang, gold: label, model: { sentiment: p.sentiment, topic: p.topic } })
    gold.labelled++
    gold.byLang[p.lang] = (gold.byLang[p.lang] ?? 0) + 1
    logEvent('relabel', `Gold label for ${postId}: ${label.sentiment}, ${label.topicSlug}${label.sarcastic ? ', sarcastic' : ''}`)
    store.emit()
    return { ok: true }
  }
  function skipGold(postId) {
    if (gold.skipped.size < 200) gold.skipped.add(postId)
    store.emit()
  }

  window.J = Object.assign(window.J, {
    store,
    api: {
      getBrief, getBoard, getGmpHistory, getSentimentTrend, getSentimentToday, getTimeline, getEvidence, relabel, undoLabel,
      sourceRows, sourceRuns, runInfo: () => DATA.run,
      getConfig: () => structuredClone(config), saveTerms, testTerms, saveSettings, validateTerms,
      getTopicsAdmin, updateTopic, promote, merge, dismiss, topicList: () => topics.filter((t) => t.status === 'active'),
      topicName: (slug) => topicBySlug(slug)?.name ?? slug,
      getAudit: (offset = 0, limit = 8) => ({ items: audit.slice(offset, offset + limit), nextCursor: offset + limit < audit.length ? offset + limit : null }),
      logEvent,
      getAccuracy, goldQueueItem, saveGold, skipGold,
      SOURCE_LABEL, SOURCE_KEYS,
    },
  })
})()
