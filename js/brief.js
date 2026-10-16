// Executive brief, redesigned for the family: "where do we stand" first, then "where to act",
// then every talking point grouped by status. Numbers stay available, but are put into words.
// Also holds the shell header and the filter bar.
;(function () {
  const { html, cn, useState, useEffect, useRef, useProgress, CountUp, delay, useFilters, useQuery, Link, Badge, Button, ToggleGroup, Skeleton, Icon, StaleBanner, ErrorPanel, formatCount, formatDeltaPct, pctSplit, filterQuery } = J

  // -------------------------------------------------------------------------------------------
  // Plain-language reading of the numbers (shared with the topic page)

  const MOODS = [
    { min: 25, key: 'pos', label: 'Positive', color: 'var(--good)' },
    { min: 10, key: 'lpos', label: 'Leaning positive', color: '#93c5fd', ink: '#1d4ed8' },
    { min: -10, key: 'mixed', label: 'Mixed', color: 'var(--calm)' },
    { min: -25, key: 'lneg', label: 'Leaning negative', color: '#fca5a5', ink: '#b91c1c' },
    { min: -Infinity, key: 'neg', label: 'Negative', color: 'var(--act)' },
  ]
  /** Net mood (positive share minus negative share), or null when there is too little data. */
  function moodOf(c) {
    if (!c.splitShown) return { key: 'early', label: 'Too early to tell', color: 'var(--calm)', net: null }
    const p = pctSplit(c)
    const net = p.pos - p.neg
    return { ...MOODS.find((m) => net >= m.min), net, pct: p }
  }
  const inTen = (pct) => Math.max(1, Math.round(pct / 10))

  const STATUS = {
    act: { label: 'Needs attention', short: 'Act now', icon: 'AlertTriangle', text: 'text-act', bg: 'bg-act-soft', border: 'border-act/30', dot: 'bg-act' },
    watch: { label: 'Keep an eye on', short: 'Watch', icon: 'Eye', text: 'text-watch', bg: 'bg-watch-soft', border: 'border-watch/30', dot: 'bg-watch' },
    good: { label: 'Going well', short: 'Going well', icon: 'CheckCircle', text: 'text-good', bg: 'bg-good-soft', border: 'border-good/30', dot: 'bg-good' },
  }
  /** act: mostly negative or a suspected organised push; good: clearly positive; else watch. */
  // Status is judged only among posts that take a side (positive or negative): most coverage is
  // neutral news, so shares of *all* posts would put nearly every talking point in the middle.
  const MIN_OPINIONS = 3
  function opinionOf(t) {
    const n = t.pos + t.neg
    return { n, neg: n ? t.neg / n : 0, pos: n ? t.pos / n : 0 }
  }
  /** act: a quarter or more of the people taking a side are negative (or a suspected organised push);
   *  good: fewer than a quarter; watch: too few people have taken a side yet. */
  function topicStatus(t) {
    if ((t.suspectedCoordinated ?? 0) >= 10) return 'act'
    const o = opinionOf(t)
    if (o.n < MIN_OPINIONS) return 'watch'
    return o.neg >= 0.25 ? 'act' : 'good'
  }
  function momentumOf(t) {
    if (t.trend === 'new') return { label: 'New this week', icon: 'Sparkles' }
    if (t.trend === 'up') return { label: t.deltaPct >= 50 ? 'Growing fast' : 'Growing', icon: 'TrendingUp' }
    if (t.trend === 'down') return { label: 'Cooling down', icon: 'TrendingDown' }
    return { label: 'Steady', icon: 'Minus' }
  }
  /** One sentence on why a talking point has its status. */
  function reasonFor(t) {
    const fast = t.trend === 'up' && t.deltaPct >= 50 ? ', and the conversation is growing fast' : ''
    if ((t.suspectedCoordinated ?? 0) >= 10) return `${t.suspectedCoordinated} near-identical posts appeared together. This looks like an organised push (not yet confirmed)${fast}.`
    const o = opinionOf(t)
    if (o.n < MIN_OPINIONS) return `${t.items} posts this week, almost all factual news. Too few people are taking a side to judge yet${fast}.`
    const neg = Math.round(o.neg * 10), pos = 10 - neg
    return topicStatus(t) === 'act'
      ? `This week, about ${Math.max(1, neg)} in 10 of the people taking a side are negative (${t.neg} of ${o.n})${fast}.`
      : `This week, about ${Math.min(10, pos)} in 10 of the people taking a side are positive (${t.pos} of ${o.n})${fast}.`
  }
  // Suggested next steps would come from the strategy team or a summariser; none exist yet, so none are shown.
  const SUGGESTION = {}

  // -------------------------------------------------------------------------------------------
  // Shell: freshness pill, header, filter bar

  function freshnessSummary(freshness) {
    if (!freshness) return { text: 'Checking data age', stale: false }
    const enabled = freshness.filter((f) => f.enabled)
    const stale = enabled.some((f) => f.status === 'stale')
    const ages = enabled.map((f) => f.ageMin).filter((a) => a !== null).map((a) => Math.max(0, Math.round(a)))
    if (ages.length === 0) return { text: 'Waiting for first fetch', stale }
    const fresh = enabled.filter((f) => f.status !== 'stale').map((f) => Math.max(0, Math.round(f.ageMin)))
    const max = Math.max(...fresh)
    return { text: `Updated ${max <= 1 ? 'just now' : `within ${max} min`}`, stale }
  }
  const asOfFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  /** "As of" time of the data on screen, with a button that re-reads every view now. */
  function AsOfRefresh({ asOf, freshness }) {
    const [spinning, setSpinning] = useState(false)
    const { stale } = freshnessSummary(freshness)
    function refresh() {
      setSpinning(true)
      J.store.emit()
      setTimeout(() => setSpinning(false), 700)
    }
    return html`<div className="flex items-center gap-1 rounded-full bg-black/[0.04] p-1 pl-3 ring-1 ring-black/[0.05]">
      <span aria-hidden="true" className=${cn('size-1.5 rounded-full', stale ? 'bg-act' : 'bg-good')} title=${stale ? 'One or more sources are behind' : 'All sources up to date'} />
      <span className="ml-1 text-xs whitespace-nowrap text-muted-foreground" aria-live="polite">As of <span className="font-medium text-foreground">${asOf ? asOfFmt.format(new Date(asOf)) : '…'} IST</span></span>
      <button type="button" onClick=${refresh} aria-label="Refresh data" title="Refresh"
        className="ml-1 grid size-7 place-items-center rounded-full bg-white text-foreground shadow-sm ring-1 ring-black/[0.06] transition-colors outline-none hover:bg-brand hover:text-white focus-visible:ring-2 focus-visible:ring-ring">
        <${Icon} name="RefreshCw" className=${cn('size-3.5', spinning && 'animate-spin')} />
      </button>
    </div>`
  }

  function FreshnessPill({ freshness }) {
    const { text, stale } = freshnessSummary(freshness)
    return html`<${Link}
      href="/sources"
      className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium whitespace-nowrap text-muted-foreground hover:text-foreground"
      title=${stale ? 'One or more sources are behind. Open Sources for details.' : 'All sources are up to date'}
    >
      <span aria-hidden="true" className=${cn('size-1.5 rounded-full', stale ? 'bg-watch' : 'bg-good')} />
      ${text}
    </${Link}>`
  }

  // Header nav (Sources, Settings, Accuracy, Sign out) is hidden in the demo; the routes still work by URL.
  const SHOW_NAV = false
  const NAV = [
    { href: '/sources', label: 'Sources' },
    { href: '/settings', label: 'Settings' },
    { href: '/accuracy', label: 'Accuracy' },
  ]
  function Header({ onSignOut }) {
    const { filters } = useFilters()
    const { data } = useQuery(() => J.api.getBrief(filters), [filters.entity, filters.lane], { delay: 0 })
    return html`<header className="sticky top-0 z-40 border-b border-black/[0.06] bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <${Link} href="/" className="flex items-center gap-2.5">
          <span aria-hidden="true" className="grid size-8 place-items-center rounded-xl bg-brand text-white shadow-sm"><${Icon} name="Activity" className="size-4.5" /></span>
          <span className="text-base font-semibold tracking-tight">IPO Pulse</span>
        </${Link}>
        <${AsOfRefresh} asOf=${data?.asOf} freshness=${data?.freshness} />
        ${SHOW_NAV && html`<nav aria-label="Main" className="ml-auto flex items-center gap-1 text-sm">
          ${NAV.map((n) => html`<${Link} key=${n.href} href=${n.href} className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">${n.label}</${Link}>`)}
${onSignOut ? html`          <button type="button" onClick=${onSignOut} aria-label="Sign out" className="ml-1 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><${Icon} name="LogOut" />Sign out</button>` : null}
        </nav>`}
      </div>
    </header>`
  }

  // No individual is named in the filter: people are grouped as "Leadership".
  const ENTITY_OPTIONS = [
    { value: 'all', label: 'Everything' },
    { value: 'leadership', label: 'Leadership' },
    { value: 'jio', label: 'Jio' },
  ]
  const LANE_OPTIONS = [
    { value: 'all', label: 'Everywhere' },
    { value: 'social', label: 'Public social' },
    { value: 'media', label: 'News and analysts' },
  ]
  /** Pill-style segmented control: a soft track with the selected option raised on it. */
  function Segmented({ labelledBy, value, onValueChange, options }) {
    return html`<div role="group" aria-labelledby=${labelledBy} className="inline-flex max-w-full overflow-x-auto rounded-full bg-black/[0.05] p-1 [scrollbar-width:none]">
      ${options.map((o) => html`<button key=${o.value} type="button" aria-pressed=${value === o.value} onClick=${() => onValueChange(o.value)}
        className=${cn('rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring',
          value === o.value ? 'bg-white text-foreground shadow-sm ring-1 ring-black/[0.06]' : 'text-muted-foreground hover:text-foreground')}>${o.label}</button>`)}
    </div>`
  }
  function FilterBar() {
    const { filters, setFilter } = useFilters()
    return html`<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex items-center gap-2.5">
        <span id="entity-filter-label" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">About</span>
        <${Segmented} labelledBy="entity-filter-label" value=${filters.entity} onValueChange=${(v) => setFilter('entity', v)} options=${ENTITY_OPTIONS} />
      </div>
      <div className="flex min-w-0 max-w-full items-center gap-2.5">
        <span id="lane-filter-label" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Where</span>
        <${Segmented} labelledBy="lane-filter-label" value=${filters.lane} onValueChange=${(v) => setFilter('lane', v)} options=${LANE_OPTIONS} />
      </div>
    </div>`
  }

  // -------------------------------------------------------------------------------------------
  // Small visual pieces

  const SENTIMENT_STYLE = {
    positive: { label: 'Positive', bar: 'bg-good', text: 'text-good', fill: 'var(--good)' },
    neutral: { label: 'Neutral', bar: 'bg-calm', text: 'text-muted-foreground', fill: 'var(--calm)' },
    negative: { label: 'Negative', bar: 'bg-act', text: 'text-act', fill: 'var(--act)' },
  }
  const ORDER = [['positive', 'pos'], ['neutral', 'neu'], ['negative', 'neg']]
  const NotEnoughData = ({ n }) => html`<span className="text-xs text-muted-foreground">Too few posts to judge (${n})</span>`
  /** Positive / neutral / negative as one stacked bar; each segment opens its posts. */
  function SentimentBar({ counts, onOpen, className, wait = 0 }) {
    if (!counts.splitShown) return html`<div className=${cn('h-2 w-full rounded-full bg-muted', className)} title="Too few posts to judge the mood" />`
    const pct = pctSplit(counts)
    return html`<div className=${cn('anim-grow-x flex h-2 w-full gap-0.5 overflow-hidden rounded-full', className)} style=${delay(wait)}>
      ${ORDER.map(([s, k]) => {
        if (counts[k] <= 0) return null
        const st = SENTIMENT_STYLE[s]
        return html`<button key=${s} type="button" aria-label=${`${st.label} ${pct[k]}% (n=${counts[k]})`} title=${`${st.label}: ${pct[k]}%`}
          onClick=${(e) => { e.preventDefault(); e.stopPropagation(); onOpen && onOpen(s) }}
          className=${cn('h-full min-w-1 outline-none first:rounded-l-full last:rounded-r-full hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring', st.bar)}
          style=${{ width: `${pct[k]}%` }} />`
      })}
    </div>`
  }
  function SentimentLegend() {
    return html`<div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
      ${ORDER.map(([s]) => html`<span key=${s} className="inline-flex items-center gap-1.5"><span className=${cn('size-2 rounded-full', SENTIMENT_STYLE[s].bar)} />${SENTIMENT_STYLE[s].label}</span>`)}
    </div>`
  }
  function TrendArrow({ trend, deltaPct }) {
    if (trend === 'new') return html`<${Badge} variant="secondary" title="No items in the prior 24h">New</${Badge}>`
    const icon = trend === 'up' ? 'ArrowUpRight' : trend === 'down' ? 'ArrowDownRight' : 'ArrowRight'
    const text = deltaPct === null ? '0%' : formatDeltaPct(deltaPct)
    return html`<span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground tabular-nums"><${Icon} name=${icon} className="size-3.5" /><span>${text}</span></span>`
  }
  const suspectedLabel = (n) => `${formatCount(n)} suspected`
  function CoordinationCount({ n, onOpen }) {
    if (n === 0) return html`<span className="tabular-nums text-muted-foreground">${suspectedLabel(0)}</span>`
    return html`<button type="button" onClick=${onOpen} className="rounded-sm tabular-nums text-act underline-offset-4 hover:underline">${suspectedLabel(n)}</button>`
  }
  const SERIES_LABEL = { gmp_inr: 'GMP INR', sub_retail_x: 'Retail x', sub_nii_x: 'NII x', sub_qib_x: 'QIB x', sub_total_x: 'Total x' }

  const Panel = ({ className, style, children }) => html`<section style=${style} className=${cn('rounded-3xl border border-black/[0.06] bg-card p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-14px_rgba(0,0,0,0.1)]', className)}>${children}</section>`
  const PanelTitle = ({ icon, children, aside }) => html`<div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-2">
    ${icon ? html`<span className="grid size-8 place-items-center rounded-xl bg-brand-soft text-brand"><${Icon} name=${icon} className="size-3.5" /></span>` : null}
    <h2 className="text-sm font-semibold tracking-tight whitespace-nowrap">${children}</h2>
    ${aside ? html`<span className="ml-auto">${aside}</span>` : null}
  </div>`

  /** Half-circle gauge for the net mood, -50 (negative) to +50 (positive): a red-to-blue track,
   *  one marker on the arc, and the net score in the middle. */
  function MoodGauge({ net, size = 220 }) {
    const sweep = useProgress(1300, 350, net)
    const cx = 110, cy = 112, r = 86
    const ang = (v) => Math.PI - ((Math.max(-50, Math.min(50, v)) + 50) / 100) * Math.PI
    const pt = (v, rr = r) => [cx + rr * Math.cos(ang(v)), cy - rr * Math.sin(ang(v))]
    const arc = (a, b) => {
      const [x1, y1] = pt(a), [x2, y2] = pt(b)
      return `M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)}`
    }
    const [mx, my] = net === null ? [0, 0] : pt(-50 + (net + 50) * sweep)
    const ticks = [-25, 0, 25].map((v) => [pt(v, r - 14), pt(v, r - 19)])
    return html`<svg viewBox="0 0 220 134" width=${size} className="max-w-full overflow-visible" role="img" aria-label=${net === null ? 'Mood not measured yet' : `Net mood ${net > 0 ? '+' : ''}${net}`}>
      <defs>
        <linearGradient id="mood-track" x1="24" x2="196" y1="0" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--act)" />
          <stop offset="0.5" stopColor="var(--calm)" />
          <stop offset="1" stopColor="var(--good)" />
        </linearGradient>
        <filter id="mood-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="1" stdDeviation="1.6" floodOpacity="0.25" /></filter>
      </defs>
      <path d=${arc(-50, 50)} fill="none" stroke="var(--muted)" strokeWidth="12" strokeLinecap="round" />
      <path d=${arc(-50, 50)} pathLength="1" className="anim-draw" fill="none" stroke="url(#mood-track)" strokeWidth="12" strokeLinecap="round" opacity=${net === null ? 0.25 : 1} />
      ${ticks.map(([[x1, y1], [x2, y2]], i) => html`<line key=${i} x1=${x1} y1=${y1} x2=${x2} y2=${y2} stroke="var(--calm)" strokeWidth="1.5" strokeLinecap="round" />`)}
      ${net === null ? null : html`<circle cx=${mx} cy=${my} r="9" fill="white" stroke="var(--foreground)" strokeWidth="3" filter="url(#mood-shadow)" className="anim-pop" style=${delay(300)} />`}
      <text x=${cx} y=${cy - 14} textAnchor="middle" fontSize="30" fontWeight="600" className="fill-foreground" style=${{ letterSpacing: '-0.02em' }}>${net === null ? '–' : html`<${CountUp} value=${net} delay=${350} duration=${1300} format=${(v) => { const r = Math.round(v); return `${r > 0 ? '+' : ''}${r}` }} />`}</text>
      <text x=${cx} y=${cy + 4} textAnchor="middle" fontSize="10.5" className="fill-muted-foreground">net mood</text>
      <text x=${pt(-50)[0]} y=${cy + 20} textAnchor="middle" fontSize="10" className="fill-muted-foreground">Negative</text>
      <text x=${pt(50)[0]} y=${cy + 20} textAnchor="middle" fontSize="10" className="fill-muted-foreground">Positive</text>
    </svg>`
  }

  function MiniBars({ values, height = 44, highlightLast = true }) {
    const max = Math.max(1, ...values)
    return html`<div className="flex items-end gap-[3px]" style=${{ height }} aria-hidden="true">
      ${values.map((v, i) => html`<div key=${i} className=${cn('flex-1 rounded-[3px]', highlightLast && i === values.length - 1 ? 'bg-brand' : 'bg-black/10')} style=${{ height: `${Math.max(4, (v / max) * 100)}%` }} />`)}
    </div>`
  }

  function AreaSpark({ points, height = 56 }) {
    if (points.length < 2) return null
    const W = 240, H = height
    const vs = points.map((p) => p.v)
    const lo = Math.min(...vs) * 0.95, hi = Math.max(...vs) * 1.02
    const xy = points.map((p, i) => [(i / (points.length - 1)) * W, H - 4 - ((p.v - lo) / Math.max(1, hi - lo)) * (H - 8)])
    const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')
    const [lx, ly] = xy[xy.length - 1]
    return html`<svg viewBox=${`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style=${{ height }} aria-hidden="true">
      <defs><linearGradient id="gmp-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--brand)" stopOpacity="0.25" /><stop offset="1" stopColor="var(--brand)" stopOpacity="0" /></linearGradient></defs>
      <path d=${`${line}L${W},${H}L0,${H}Z`} fill="url(#gmp-fill)" />
      <path d=${line} fill="none" stroke="var(--brand)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle cx=${lx} cy=${ly} r="3.5" fill="var(--brand)" />
    </svg>`
  }

  // -------------------------------------------------------------------------------------------
  // IPO calendar (from the offer document coverage collected on 16 Oct 2026)

  const UPPER_BAND = 1119
  const MILESTONES = [
    { date: '2026-10-21', label: 'Bidding opens' },
    { date: '2026-10-23', label: 'Bidding closes' },
    { date: '2026-10-26', label: 'Allotment' },
    { date: '2026-10-28', label: 'Listing day' },
  ]
  const istDate = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(ms)
  const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
  const shortDay = (iso) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(Date.parse(iso))
  function countdownText() {
    const today = istDate()
    const next = MILESTONES.find((m) => m.date >= today)
    if (!next) return 'Jio is now listed'
    const d = daysBetween(today, next.date)
    return d === 0 ? `${next.label} today` : `${next.label} in ${d} ${d === 1 ? 'day' : 'days'}`
  }

  function IpoTimeline() {
    const today = istDate()
    const steps = [{ date: today, label: 'Today', today: true }, ...MILESTONES.filter((m) => m.date > today)]
    const past = MILESTONES.filter((m) => m.date < today)
    return html`<${Panel}>
      <${PanelTitle} icon="Calendar" aside=${html`<span className="text-xs font-medium text-brand">${countdownText()}</span>`}>Road to listing</${PanelTitle}>
      <ol className="relative grid gap-y-3 sm:grid-cols-[repeat(var(--n),minmax(0,1fr))]" style=${{ '--n': steps.length }}>
        <div aria-hidden="true" className="absolute top-[9px] right-[10%] left-[10%] hidden h-0.5 bg-border sm:block" />
        ${steps.map((s) => html`<li key=${s.date + s.label} className="relative flex items-center gap-3 sm:flex-col sm:gap-1.5 sm:text-center">
          <span className=${cn('z-10 size-5 rounded-full border-4', s.today ? 'border-brand bg-white ring-4 ring-brand/15' : 'border-border bg-white')} />
          <div>
            <div className=${cn('text-sm font-medium', s.today && 'text-brand')}>${s.label}</div>
            <div className="text-xs text-muted-foreground">${shortDay(s.date)}${s.today ? '' : ` · in ${daysBetween(today, s.date)} days`}</div>
          </div>
        </li>`)}
      </ol>
      ${past.length ? html`<p className="mt-3 text-xs text-muted-foreground">Done: ${past.map((p) => p.label).join(', ')}</p>` : null}
    </${Panel}>`
  }

  // -------------------------------------------------------------------------------------------
  // "Where we stand"

  function greeting() {
    const h = Number(new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hourCycle: 'h23' }).format(Date.now()))
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  }

  /** One compact summary: the headline sentence, one supporting line, and the mood dial. */
  function Summary({ kpis, groups, onOpen }) {
    const mood = moodOf({ ...kpis, items: kpis.items24h })
    const n = groups.act.length
    const attention = n === 0 ? 'Nothing needs urgent action.' : `${n} ${n === 1 ? 'talking point needs' : 'talking points need'} attention.`
    const prev = kpis.itemsPrev24h
    const delta = prev ? Math.round(((kpis.items24h - prev) / prev) * 100) : null
    const volume = delta === null ? 'new today' : delta >= 10 ? `up ${delta}% on yesterday` : delta <= -10 ? `down ${-delta}% on yesterday` : 'about the same as yesterday'
    const link = 'font-medium underline-offset-4 hover:underline'
    return html`<section className="anim-up relative grid items-center gap-6 overflow-hidden rounded-3xl border border-black/[0.06] bg-[radial-gradient(90%_120%_at_100%_0%,rgba(37,99,235,0.10),transparent_60%),linear-gradient(180deg,#ffffff,#fbfbfc)] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-14px_rgba(0,0,0,0.1)] p-7 sm:p-8 md:grid-cols-[1fr_auto]">
      <div>
        <p className="text-sm text-muted-foreground">${greeting()}. Here is where the Jio IPO stands.</p>
        <h1 className="mt-1.5 max-w-2xl text-2xl leading-tight font-semibold tracking-tight sm:text-[32px]">
          Public mood is <span className="rounded-lg bg-brand px-2 text-white">${mood.label.toLowerCase()}</span>. ${attention}
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          ${mood.net === null
            ? 'Too few posts to read the mood yet. '
            : html`<button type="button" className=${cn(link, 'text-good')} onClick=${() => onOpen({ sentiment: 'positive' })}><${CountUp} value=${mood.pct.pos} />% of posts are positive</button> and <button type="button" className=${cn(link, 'text-act')} onClick=${() => onOpen({ sentiment: 'negative' })}><${CountUp} value=${mood.pct.neg} />% negative</button>; the rest are neutral. That is from <button type="button" className=${cn(link, 'text-foreground')} onClick=${() => onOpen({ window: '24h' })}><${CountUp} value=${kpis.items24h} /> posts today</button> (${volume}).`}
        </p>
      </div>
      <div className="justify-self-center md:justify-self-end"><${MoodGauge} net=${mood.net} size=${200} /></div>
    </section>`
  }

  // -------------------------------------------------------------------------------------------
  // Mood today: share of positive and negative posts in each 3-hour IST block since midnight,
  // with volume behind. Blocks with fewer than MIN_HOURLY posts are left out of the lines.

  const MIN_HOURLY = 5
  const hourFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const hourLabel = (iso) => hourFmt.format(new Date(iso))
  function trendCaption(hours) {
    const shown = hours.filter((d) => d.items >= MIN_HOURLY)
    if (shown.length < 2) return 'Not enough posts yet today to show how the mood is moving.'
    const a = pctSplit(shown[0]), b = pctSplit(shown[shown.length - 1])
    const move = (from, to, what) => {
      const d = to - from
      return Math.abs(d) < 4 ? `${what} held steady around ${to}%` : `${what} ${d > 0 ? 'rose' : 'fell'} from ${from}% to ${to}%`
    }
    return `Since ${hourLabel(shown[0].from)}, ${move(a.pos, b.pos, 'positive').replace(/^p/, 'p')}; ${move(a.neg, b.neg, 'negative')}.`
  }

  function SentimentTrend({ filters, onOpen }) {
    // Rendered inside a Panel that rises in; the chart parts below animate on top of that.
    const [hover, setHover] = useState(null)
    const [W, setW] = useState(720)
    const box = useRef(null)
    useEffect(() => {
      if (!box.current) return
      const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))))
      ro.observe(box.current)
      return () => ro.disconnect()
    }, [])
    const days = J.api.getSentimentToday(filters)
    const H = 220, L = 44, R = 30, T = 14, B = 30
    const iw = W - L - R, ih = H - T - B
    const step = iw / Math.max(1, days.length - 1)
    const pts = days.map((d, i) => ({ ...d, i, x: L + i * step, pct: d.items >= MIN_HOURLY ? pctSplit(d) : null }))
    const bw = Math.min(20, step * 0.6)
    const labelEvery = 1
    const yMax = Math.max(60, ...pts.filter((p) => p.pct).map((p) => Math.max(p.pct.pos, p.pct.neg) + 10))
    const y = (v) => T + ih - (v / yMax) * ih
    const maxItems = Math.max(1, ...days.map((d) => d.items))
    const line = (k) => pts.filter((p) => p.pct).map((p, j) => `${j ? 'L' : 'M'}${p.x.toFixed(1)},${y(p.pct[k]).toFixed(1)}`).join('')
    const shown = pts.filter((p) => p.pct)
    const area = shown.length > 1 ? `${line('pos')}L${shown[shown.length - 1].x},${T + ih}L${shown[0].x},${T + ih}Z` : ''
    const h = hover !== null ? pts[hover] : null
    const last = days.length - 1
    const label = (p) => (p.i === last ? 'Now' : hourLabel(p.from))
    return html`<${Panel} className="anim-up" style=${delay(120)}>
      <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-base font-semibold tracking-tight">Mood today</h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground sm:ml-auto">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="h-0.5 w-4 rounded-full bg-good" />Positive share</span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="h-0.5 w-4 rounded-full bg-act" />Negative share</span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="size-2.5 rounded-sm bg-black/[0.07]" />Posts per 3 hours</span>
        </div>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">${trendCaption(days)}</p>
      <div className="relative" ref=${box}>
        <svg viewBox=${`0 0 ${W} ${H}`} width=${W} height=${H} className="block w-full" role="img" aria-label=${trendCaption(days)} onMouseLeave=${() => setHover(null)}>
          <defs><linearGradient id="pos-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--good)" stopOpacity="0.28" /><stop offset="1" stopColor="var(--good)" stopOpacity="0" /></linearGradient></defs>
          ${[0, 25, 50].filter((v) => v <= yMax).map((v) => html`<g key=${v}>
            <line x1=${L} x2=${W - R} y1=${y(v)} y2=${y(v)} stroke="rgba(0,0,0,0.08)" strokeDasharray=${v ? '3 4' : ''} />
            <text x=${L - 8} y=${y(v) + 3} fontSize="10" textAnchor="end" className="fill-muted-foreground">${v}%</text>
          </g>`)}
          ${pts.map((p) => html`<rect key=${'v' + p.i} className="anim-grow-y" style=${delay(150 + p.i * 60)} x=${p.x - bw / 2} width=${bw} rx="4" y=${T + ih - (p.items / maxItems) * ih * 0.4} height=${(p.items / maxItems) * ih * 0.4} fill="rgba(0,0,0,0.035)" />`)}
          ${area ? html`<path d=${area} fill="url(#pos-fill)" className="anim-in" style=${delay(700)} />` : null}
          <path d=${line('pos')} pathLength="1" className="anim-draw" style=${delay(250)} fill="none" stroke="var(--good)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          <path d=${line('neg')} pathLength="1" className="anim-draw" style=${delay(400)} fill="none" stroke="var(--act)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          ${h ? html`<line x1=${h.x} x2=${h.x} y1=${T} y2=${T + ih} stroke="rgba(0,0,0,0.2)" />` : null}
          ${shown.map((p) => html`<g key=${'d' + p.i}>
            <circle cx=${p.x} cy=${y(p.pct.pos)} r=${hover === p.i ? 5 : 3.5} fill="var(--card)" stroke="var(--good)" strokeWidth="2" className="anim-pop" style=${delay(300 + (p.i / Math.max(1, pts.length - 1)) * 1000)} />
            <circle cx=${p.x} cy=${y(p.pct.neg)} r=${hover === p.i ? 5 : 3.5} fill="var(--card)" stroke="var(--act)" strokeWidth="2" className="anim-pop" style=${delay(450 + (p.i / Math.max(1, pts.length - 1)) * 1000)} />
          </g>`)}
          ${pts.map((p) => html`<g key=${'x' + p.i}>
            ${p.i === last || (p.i % labelEvery === 0 && last - p.i >= labelEvery / 2 + 0.5) ? html`<text x=${p.x} y=${H - 8} fontSize="11" textAnchor="middle" className=${p.i === last ? 'fill-foreground font-medium' : 'fill-muted-foreground'}>${label(p)}</text>` : null}
            <rect x=${p.x - step / 2} y=${T} width=${step} height=${ih} fill="transparent" className=${p.items ? 'cursor-pointer' : ''}
              onMouseEnter=${() => setHover(p.i)} onClick=${() => p.items && onOpen({ window: '24h', from: p.from, to: p.to })} />
          </g>`)}
        </svg>
        ${h
          ? html`<div className="pointer-events-none absolute top-0 rounded-xl border border-black/[0.08] bg-white px-3 py-2 text-xs shadow-lg" style=${{ left: `${Math.min(78, Math.max(0, (h.x / W) * 100 - 8))}%` }}>
              <div className="mb-1 font-medium">${h.i === last ? `${hourLabel(h.from)} – now` : `${hourLabel(h.from)} – ${hourLabel(h.to)}`} · ${formatCount(h.items)} posts</div>
              ${h.pct
                ? html`<div className="text-good">Positive ${h.pct.pos}%</div><div className="text-muted-foreground">Neutral ${h.pct.neu}%</div><div className="text-act">Negative ${h.pct.neg}%</div><div className="mt-1 text-muted-foreground">Click to read these posts</div>`
                : html`<div className="text-muted-foreground">Too few posts to judge</div>`}
            </div>`
          : null}
      </div>
    </${Panel}>`
  }

  function MoodCard({ kpis, onOpen }) {
    const c = { ...kpis, items: kpis.items24h }
    const mood = moodOf(c)
    return html`<${Panel} className="flex flex-col">
      <${PanelTitle} icon="Users">Overall mood</${PanelTitle}>
      <div className="flex flex-1 flex-col items-center justify-center gap-1">
        <${MoodGauge} net=${mood.net} />
        <div className="text-lg font-semibold" style=${{ color: mood.ink ?? (mood.color === 'var(--calm)' ? 'var(--foreground)' : mood.color) }}>${mood.label}</div>
        ${mood.net === null
          ? html`<p className="text-center text-sm text-muted-foreground">Too few posts to read the mood yet.</p>`
          : html`<p className="text-center text-sm text-muted-foreground">
              Out of every 10 posts, about <button type="button" className="font-medium text-good underline-offset-4 hover:underline" onClick=${() => onOpen({ sentiment: 'positive' })}>${inTen(mood.pct.pos)} are positive</button>${' '}
              and <button type="button" className="font-medium text-act underline-offset-4 hover:underline" onClick=${() => onOpen({ sentiment: 'negative' })}>${inTen(mood.pct.neg)} negative</button>.
            </p>`}
      </div>
    </${Panel}>`
  }

  function BuzzCard({ kpis, topics, onOpen }) {
    const hourly = Array.from({ length: 24 }, (_, i) => topics.reduce((a, t) => a + (t.spark[i] ?? 0), 0))
    const prev = kpis.itemsPrev24h
    const delta = prev ? Math.round(((kpis.items24h - prev) / prev) * 100) : null
    const words = delta === null ? 'New activity today' : delta >= 10 ? `${delta}% more than the day before` : delta <= -10 ? `${-delta}% less than the day before` : 'About the same as the day before'
    const icon = delta === null ? 'Sparkles' : delta >= 10 ? 'TrendingUp' : delta <= -10 ? 'TrendingDown' : 'Minus'
    return html`<${Panel} className="flex flex-col">
      <${PanelTitle} icon="Megaphone">How much people are talking</${PanelTitle}>
      <button type="button" onClick=${() => onOpen({ window: '24h' })} className="w-fit text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="text-3xl font-semibold tabular-nums">${formatCount(kpis.items24h)}</span>
        <span className="ml-1.5 text-sm text-muted-foreground">posts today</span>
      </button>
      <p className=${cn('mt-1 inline-flex items-center gap-1.5 text-sm', delta >= 10 ? 'text-brand' : 'text-muted-foreground')}><${Icon} name=${icon} className="size-4" />${words}</p>
      <div className="mt-auto pt-4">
        <${MiniBars} values=${hourly} />
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground"><span>24 hours ago</span><span>Now</span></div>
      </div>
    </${Panel}>`
  }

  function GmpCard({ market }) {
    const latest = market.items.find((m) => m.series === 'gmp_inr' && m.sourceKey === 'portal_ipowatch') ?? market.items.find((m) => m.series === 'gmp_inr')
    const history = J.api.getGmpHistory()
    if (!latest) return html`<${Panel}><${PanelTitle} icon="IndianRupee">Grey market price</${PanelTitle}><p className="text-sm text-muted-foreground">No grey-market price yet.</p></${Panel}>`
    const premium = Math.round((latest.value / UPPER_BAND) * 100)
    const first = history[0]
    return html`<${Panel} className="flex flex-col">
      <${PanelTitle} icon="IndianRupee" aside=${html`<${Badge} variant="secondary" className="font-normal">Unofficial</${Badge}>`}>Grey market price</${PanelTitle}>
      <div><span className="text-3xl font-semibold tabular-nums">₹${formatCount(Math.round(latest.value))}</span><span className="ml-1.5 text-sm text-muted-foreground">premium per share</span></div>
      <p className="mt-1 text-sm text-muted-foreground">Traders expect a listing about <span className="font-medium text-good">${premium}% above</span> the ₹${formatCount(UPPER_BAND)} issue price.</p>
      <div className="mt-auto pt-4">
        <${AreaSpark} points=${history} />
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground"><span>${first ? `₹${Math.round(first.v)} a week ago` : 'A week ago'}</span><span>Now</span></div>
      </div>
    </${Panel}>`
  }

  // -------------------------------------------------------------------------------------------
  // "Where to act" and the talking-point board

  function ActionCard({ t, filters, onOpen }) {
    const base = { topic: t.slug, topicName: t.name }
    const coord = (t.suspectedCoordinated ?? 0) >= 10
    return html`<article className="flex flex-col gap-3 rounded-2xl border border-act/25 bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-act-soft px-2 py-0.5 text-xs font-medium text-act"><${Icon} name="AlertTriangle" className="size-3" />Act now</span>
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground"><${Icon} name=${momentumOf(t).icon} className="size-3.5" />${momentumOf(t).label}</span>
      </div>
      <h3 className="text-base leading-snug font-semibold">${t.name}</h3>
      <p className="text-sm text-muted-foreground">${reasonFor(t)}</p>
      <${SentimentBar} counts=${t} onOpen=${(sentiment) => onOpen({ ...base, sentiment })} />
      ${SUGGESTION[t.slug]
        ? html`<div className="flex gap-2.5 rounded-xl bg-brand-soft p-3 text-sm text-foreground">
            <${Icon} name="Lightbulb" className="mt-0.5 size-4 shrink-0 text-brand" />
            <p><span className="font-semibold">Suggested: </span>${SUGGESTION[t.slug]}</p>
          </div>`
        : null}
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <${Button} size="sm" onClick=${() => onOpen(coord ? { ...base, coordinated: true } : { ...base, sentiment: 'negative' })}>${coord ? 'See the suspicious posts' : 'See the critical posts'}</${Button}>
        <${Link} href=${`/topics/${t.slug}${filterQuery(filters)}`} className="inline-flex h-8 items-center gap-1 rounded-md px-3 text-sm font-medium text-brand hover:bg-brand-soft">Full picture<${Icon} name="ArrowRight" className="size-3.5" /></${Link}>
      </div>
    </article>`
  }

  function WhereToAct({ act, filters, onOpen }) {
    return html`<section aria-labelledby="act-h" className="flex flex-col gap-3">
      <div>
        <h2 id="act-h" className="text-lg font-semibold">Where to act</h2>
        <p className="text-sm text-muted-foreground">The talking points most likely to hurt the IPO if left alone, most important first.</p>
      </div>
      ${act.length === 0
        ? html`<${Panel} className="flex items-center gap-3 border-good/30 bg-good-soft"><${Icon} name="CheckCircle" className="size-5 text-good" /><p className="text-sm">Nothing needs action right now. The conversation is broadly healthy.</p></${Panel}>`
        : html`<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">${act.slice(0, 3).map((t) => html`<${ActionCard} key=${t.slug} t=${t} filters=${filters} onOpen=${onOpen} />`)}</div>`}
    </section>`
  }

  function TopicTile({ t, filters, onOpen, wait = 0 }) {
    const mood = moodOf(t)
    const m = momentumOf(t)
    return html`<${Link} href=${`/topics/${t.slug}${filterQuery(filters)}`} style=${delay(wait)} className="anim-up group flex flex-col gap-2.5 rounded-2xl border border-black/[0.06] bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-[0_10px_24px_-12px_rgba(0,0,0,0.15)]">
      <div className="flex items-start gap-2">
        <span className="flex-1 text-sm leading-snug font-medium group-hover:text-brand">${t.name}</span>
        <${Icon} name="ChevronRight" className="mt-0.5 size-4 text-muted-foreground group-hover:text-brand" />
      </div>
      <${SentimentBar} counts=${t} wait=${wait + 200} onOpen=${(sentiment) => onOpen({ topic: t.slug, topicName: t.name, sentiment })} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style=${{ background: mood.color }} />${mood.label}</span>
        <span className="inline-flex items-center gap-1"><${Icon} name=${m.icon} className="size-3.5" />${m.label}</span>
        <span className="ml-auto tabular-nums">${formatCount(t.items)} this week</span>
      </div>
    </${Link}>`
  }

  function TopicBoard({ groups, filters, onOpen }) {
    const cols = ['act', 'watch', 'good']
    return html`<section aria-labelledby="board-h" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="board-h" className="text-xl font-semibold tracking-tight">All talking points</h2>
          <p className="text-sm text-muted-foreground">This week's talking points, sorted by how people taking a side feel about them. Open any one for the full picture.</p>
        </div>
        <${SentimentLegend} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        ${cols.map((k, ci) => {
          const st = STATUS[k]
          const list = groups[k]
          return html`<div key=${k} style=${delay(ci * 90)} className=${cn('anim-in flex flex-col gap-3 rounded-3xl bg-black/[0.03] p-3')}>
            <div className="flex items-center gap-2 px-1.5 pt-1 text-sm font-semibold tracking-tight">
              <span className=${cn('grid size-6 place-items-center rounded-lg', st.bg, st.text)}><${Icon} name=${st.icon} className="size-3.5" /></span>${st.label}
              <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-black/[0.06]"><${CountUp} value=${list.length} duration=${600} /></span>
            </div>
            ${list.length === 0 ? html`<p className="px-1 py-2 text-xs text-muted-foreground">None right now</p>` : list.map((t, i) => html`<${TopicTile} key=${t.slug} t=${t} filters=${filters} onOpen=${onOpen} wait=${ci * 90 + i * 70 + 150} />`)}
          </div>`
        })}
      </div>
    </section>`
  }

  function BriefFooter({ emerging, unclassified, onOpen }) {
    const acc = J.api.getAccuracy()
    return html`<footer className="flex flex-col gap-2 border-t pt-4 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <p>
        ${emerging.count ? html`Also seen: <button type="button" className="underline-offset-4 hover:text-foreground hover:underline" onClick=${() => onOpen({ topic: 'emerging' })}>${formatCount(emerging.count)} ${emerging.count === 1 ? 'post' : 'posts'} on ${emerging.candidates} new ${emerging.candidates === 1 ? 'theme' : 'themes'}</button>${' · '}` : null}
        ${unclassified.count ? html`<button type="button" className="underline-offset-4 hover:text-foreground hover:underline" onClick=${() => onOpen({ topic: 'unclassified' })}>${formatCount(unclassified.count)} not yet sorted</button>${' · '}` : null}
        Instagram and LinkedIn are sampled, not complete.
      </p>
      <${Link} href="/accuracy" className="underline-offset-4 hover:underline">
        ${acc.measured ? `Reading accuracy: ${Math.round(acc.overall.sentiment * 100)}%` : 'Reading accuracy is still being measured'}
      </${Link}>
    </footer>`
  }

  function BriefSkeleton() {
    return html`<div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading brief">
      <${Skeleton} className="h-44 rounded-3xl" />
      <${Skeleton} className="h-64 rounded-2xl" />
    </div>`
  }

  function groupTopics(topics) {
    const groups = { act: [], watch: [], good: [] }
    for (const t of topics) groups[topicStatus(t)].push(t)
    return groups
  }

  function BriefView() {
    const { filters } = useFilters()
    const open = J.useOpenEvidence()
    const query = useQuery(() => J.api.getBrief(filters), [filters.entity, filters.lane])
    const { data } = query
    if (!data) return query.isError ? html`<${ErrorPanel} text="Could not load the brief." onRetry=${query.refetch} />` : html`<${BriefSkeleton} />`
    if (data.kpis.items24h === 0 && data.topics.length === 0) {
      return html`<${Panel}><p className="text-muted-foreground">Collecting: the first picture appears after the first fetch cycle (about 15 min).</p></${Panel}>`
    }
    const groups = groupTopics(J.api.getBoard(filters))
    return html`<div key=${`${filters.entity}-${filters.lane}`} className="flex flex-col gap-8">
      ${query.isError ? html`<${StaleBanner} asOf=${data.asOf} onRetry=${query.refetch} />` : null}
      <div className="flex flex-col gap-4">
        <${Summary} kpis=${data.kpis} groups=${groups} onOpen=${open} />
        <${SentimentTrend} filters=${filters} onOpen=${open} />
      </div>
      <${TopicBoard} groups=${groups} filters=${filters} onOpen=${open} />
      <${BriefFooter} emerging=${data.emerging} unclassified=${data.unclassified} onOpen=${open} />
    </div>`
  }

  function BriefPage() {
    return html`<div className="flex flex-col gap-5">
      <${FilterBar} />
      <${BriefView} />
    </div>`
  }

  Object.assign(J, {
    Header, FilterBar, BriefPage, SentimentBar, SentimentLegend, NotEnoughData, SENTIMENT_STYLE, TrendArrow, CoordinationCount, suspectedLabel, SERIES_LABEL, freshnessSummary,
    moodOf, topicStatus, momentumOf, reasonFor, inTen, STATUS, SUGGESTION, Panel, PanelTitle, MoodGauge, MiniBars, AreaSpark, GmpCard,
  })
})()
