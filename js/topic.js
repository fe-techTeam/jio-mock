// Topic detail (/topics/[slug]), simplified for the family: status and what to do first, then the
// mood, the week, where it is being said and who it is about, then the posts behind it.
;(function () {
  const { html, cn, useProgress, CountUp, delay, useFilters, useQuery, Button, Skeleton, Icon, StaleBanner, ErrorPanel, BackLink, Link, formatIst, pctSplit } = J

  const HOUR = 3_600_000
  const dayLabel = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric' })
  const dormantText = (lastItemAt) => (lastItemAt ? `Quiet: the last post was at ${formatIst(lastItemAt, 'datetime')}` : 'Quiet: no posts yet')

  /** The topic's row from the brief, so status and mood match the dashboard; else rebuilt from the timeline. */
  function topicSummary(d, filters) {
    const row = J.api.getBoard(filters).find((t) => t.slug === d.topic.slug)
    if (row) return row
    const sum = (rows) => rows.reduce((a, r) => ({ items: a.items + r.items, pos: a.pos + r.pos, neu: a.neu + r.neu, neg: a.neg + r.neg }), { items: 0, pos: 0, neu: 0, neg: 0 })
    const week = sum(d.series)
    const curN = sum(d.series.slice(-24)).items
    const prev = sum(d.series.slice(-48, -24)).items
    const deltaPct = prev ? Math.round(((curN - prev) / prev) * 1000) / 10 : null
    return { ...week, slug: d.topic.slug, name: d.topic.name, splitShown: week.items >= 10, itemsPrev24h: prev, deltaPct, trend: prev === 0 ? (curN ? 'new' : 'flat') : deltaPct >= 10 ? 'up' : deltaPct <= -10 ? 'down' : 'flat', suspectedCoordinated: 0 }
  }

  /** Hourly series folded into IST days, oldest first. */
  function toDays(series) {
    const days = []
    for (const h of series) {
      const label = dayLabel.format(new Date(h.hourStart))
      let d = days[days.length - 1]
      if (!d || d.label !== label) days.push((d = { label, from: h.hourStart, to: h.hourStart, items: 0, pos: 0, neu: 0, neg: 0 }))
      d.items += h.items
      d.pos += h.pos
      d.neu += h.neu
      d.neg += h.neg
      d.to = new Date(new Date(h.hourStart).getTime() + HOUR).toISOString()
    }
    return days.slice(-7)
  }

  // --- Header and "what to do" ----------------------------------------------------------------
  function TopicHeader({ d, t, back }) {
    const status = J.STATUS[J.topicStatus(t)]
    return html`<header className="anim-up flex flex-col gap-3">
      <${BackLink} href=${back}>Back to the overview</${BackLink}>
      <div className="flex flex-wrap items-center gap-2">
        <span className=${cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', status.bg, status.text)}><${Icon} name=${status.icon} className="size-3" />${status.label}</span>
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><${Icon} name=${J.momentumOf(t).icon} className="size-3.5" />${J.momentumOf(t).label}</span>
      </div>
      <h1 className="text-2xl font-semibold sm:text-3xl">${d.topic.name}</h1>
      ${d.topic.summary2line ? html`<p className="max-w-3xl text-[15px] leading-relaxed text-muted-foreground">${d.topic.summary2line}</p>` : null}
      ${d.topic.items24h === 0 ? html`<p className="text-sm text-muted-foreground">${dormantText(d.topic.lastItemAt)}</p>` : null}
    </header>`
  }

  function WhatToDo({ t }) {
    const suggestion = J.SUGGESTION[t.slug]
    const status = J.topicStatus(t)
    return html`<section style=${delay(80)} className=${cn('anim-up grid gap-4 rounded-2xl border p-5 md:grid-cols-[1fr_1.3fr]', J.STATUS[status].border, 'bg-card shadow-sm')}>
      <div>
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Why it matters</h2>
        <p className="mt-1.5 text-[15px]">${J.reasonFor(t)}</p>
      </div>
      ${suggestion
        ? html`<div className="flex gap-3 rounded-xl bg-brand-soft p-4 text-foreground">
            <${Icon} name="Lightbulb" className="mt-0.5 size-5 shrink-0 text-brand" />
            <div><h2 className="text-xs font-semibold tracking-wide uppercase">Suggested next step</h2><p className="mt-1 text-[15px]">${suggestion}</p></div>
          </div>`
        : null}
    </section>`
  }

  // --- At a glance ----------------------------------------------------------------------------
  function Donut({ c, size = 120 }) {
    const r = 46, C = 2 * Math.PI * r
    const grow = useProgress(1100, 250, `${c.pos}-${c.neu}-${c.neg}`)
    if (!c.splitShown) return html`<svg width=${size} height=${size} viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r=${r} fill="none" stroke="var(--muted)" strokeWidth="14" /></svg>`
    const p = pctSplit(c)
    let off = 0
    const segs = [['pos', 'var(--good)'], ['neu', 'var(--calm)'], ['neg', 'var(--act)']].map(([k, col]) => {
      const len = (p[k] / 100) * C * grow
      const s = html`<circle key=${k} cx="60" cy="60" r=${r} fill="none" stroke=${col} strokeWidth="14" strokeDasharray=${`${Math.max(0, len - 2)} ${C}`} strokeDashoffset=${-off} transform="rotate(-90 60 60)" />`
      off += len
      return s
    })
    return html`<svg width=${size} height=${size} viewBox="0 0 120 120" role="img" aria-label=${`${p.pos}% positive, ${p.neu}% neutral, ${p.neg}% negative`}>
      ${segs}
      <text x="60" y="58" textAnchor="middle" fontSize="20" fontWeight="600" className="fill-foreground"><${CountUp} value=${p.pos} delay=${250} duration=${1100} />%</text>
      <text x="60" y="74" textAnchor="middle" fontSize="10" className="fill-muted-foreground">positive</text>
    </svg>`
  }

  function MoodPanel({ t, onOpen }) {
    const mood = J.moodOf(t)
    const p = t.splitShown ? pctSplit(t) : null
    return html`<${J.Panel} className="anim-up flex flex-col" style=${delay(120)}>
      <${J.PanelTitle} icon="Users">Mood this week</${J.PanelTitle}>
      <div className="flex flex-1 items-center justify-center gap-6">
        <${Donut} c=${t} />
        <div className="flex flex-col gap-2">
          <div className="text-lg font-semibold" style=${{ color: mood.ink }}>${mood.label}</div>
          ${p
            ? html`<ul className="flex flex-col gap-1 text-sm">
                ${[['positive', 'pos', 'bg-good'], ['neutral', 'neu', 'bg-calm'], ['negative', 'neg', 'bg-act']].map(([s, k, dot], i) => html`<li key=${s} className="anim-up" style=${delay(400 + i * 90)}>
                  <button type="button" onClick=${() => onOpen({ topic: t.slug, topicName: t.name, sentiment: s, window: '24h' })} className="inline-flex items-center gap-2 underline-offset-4 hover:underline">
                    <span className=${cn('size-2 rounded-full', dot)} />${J.SENTIMENT_STYLE[s].label}<span className="text-muted-foreground tabular-nums">${p[k]}%</span>
                  </button>
                </li>`)}
              </ul>`
            : html`<p className="text-sm text-muted-foreground">Only ${t.items} posts this week, too few to judge.</p>`}
        </div>
      </div>
    </${J.Panel}>`
  }

  function WeekPanel({ slug, name, days, onOpen }) {
    const max = Math.max(1, ...days.map((d) => d.items))
    const first = days.slice(0, -1)
    const avg = first.length ? first.reduce((a, d) => a + d.items, 0) / first.length : 0
    const last = days[days.length - 1]
    const caption = !last || last.items === 0 ? 'Quiet today.' : avg && last.items >= avg * 1.5 ? 'Much busier today than the rest of the week.' : avg && last.items <= avg * 0.6 ? 'Quieter today than the rest of the week.' : 'About as busy today as the rest of the week.'
    return html`<${J.Panel} className="anim-up flex flex-col" style=${delay(200)}>
      <${J.PanelTitle} icon="Calendar" aside=${html`<${J.SentimentLegend} />`}>This week</${J.PanelTitle}>
      <p className="-mt-1 mb-3 text-sm text-muted-foreground">${caption} Tap a day to read its posts.</p>
      <div className="flex flex-1 items-end gap-2" style=${{ minHeight: 160 }}>
        ${days.map((d, i) => html`<button key=${d.label} type="button" disabled=${!d.items} title=${`${d.label}: ${d.items} posts`}
            onClick=${() => onOpen({ topic: slug, topicName: name, window: '7d', from: d.from, to: d.to })}
            className="group flex h-full flex-1 flex-col items-center justify-end gap-1 outline-none disabled:cursor-default">
          <span className="flex w-full flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[11px] text-muted-foreground tabular-nums">${d.items || ''}</span>
            <span style=${{ ...delay(350 + i * 80), height: `calc(${Math.max(2, (d.items / max) * 100)}% - 20px)`, minHeight: 2 }} className="anim-grow-y flex w-full max-w-12 flex-col-reverse overflow-hidden rounded-md group-hover:opacity-80 group-focus-visible:ring-2 group-focus-visible:ring-ring">
              ${d.items === 0 ? html`<span className="h-full bg-muted" />` : [['pos', 'bg-good'], ['neu', 'bg-calm'], ['neg', 'bg-act']].map(([k, c]) => html`<span key=${k} className=${c} style=${{ height: `${(d[k] / d.items) * 100}%` }} />`)}
            </span>
          </span>
          <span className=${cn('text-[11px]', i === days.length - 1 ? 'font-semibold text-brand' : 'text-muted-foreground')}>${i === days.length - 1 ? 'Today' : d.label}</span>
        </button>`)}
      </div>
    </${J.Panel}>`
  }

  function WherePanel({ slug, rows, onOpen }) {
    const max = Math.max(1, ...rows.map((r) => r.items))
    const top = rows.slice(0, 6)
    return html`<${J.Panel} className="anim-up" style=${delay(220)}>
      <${J.PanelTitle} icon="Megaphone">Where it is being said</${J.PanelTitle}>
      ${top.length === 0
        ? html`<p className="text-sm text-muted-foreground">No posts in the last day.</p>`
        : html`<ul className="flex flex-col gap-2.5">
            ${top.map((r, i) => html`<li key=${r.sourceKey}>
              <button type="button" onClick=${() => onOpen({ topic: slug, source: r.sourceKey, window: '24h' })} className="group grid w-full grid-cols-[7.5rem_1fr_2.5rem] items-center gap-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="truncate group-hover:text-brand">${J.sourceLabel(r.sourceKey).replace(/ \((official API|Apify)\)/, '')}</span>
                <span className="h-2.5 rounded-full bg-muted"><span className="anim-grow-x block h-full rounded-full bg-neutral-800 group-hover:bg-brand" style=${{ ...delay(300 + i * 80), width: `${(r.items / max) * 100}%` }} /></span>
                <span className="text-right text-xs text-muted-foreground tabular-nums">${r.items}</span>
              </button>
            </li>`)}
          </ul>`}
      ${rows.some((r) => r.coverageLabel === 'sampled') ? html`<p className="mt-3 text-xs text-muted-foreground">Instagram and LinkedIn are samples, not every post.</p>` : null}
    </${J.Panel}>`
  }

  const WHO_LABEL = { leadership: 'Leadership', jio: 'Jio the company' }
  function WhoPanel({ slug, rows, onOpen }) {
    const total = rows.reduce((a, r) => a + r.items, 0)
    return html`<${J.Panel} className="anim-up" style=${delay(260)}>
      <${J.PanelTitle} icon="Users">Who it is about</${J.PanelTitle}>
      ${total === 0
        ? html`<p className="text-sm text-muted-foreground">No posts mention the leadership or the company directly today.</p>`
        : html`<ul className="flex flex-col gap-4">
            ${rows.map((r, i) => html`<li key=${r.entity} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">${WHO_LABEL[r.entity]}</span>
                ${r.items
                  ? html`<button type="button" onClick=${() => onOpen({ topic: slug, entity: r.entity, window: '24h' })} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">${r.items} posts · ${J.moodOf(r).label.toLowerCase()}</button>`
                  : html`<span className="text-xs text-muted-foreground">Not mentioned</span>`}
              </div>
              <${J.SentimentBar} counts=${r} wait=${350 + i * 120} onOpen=${(sentiment) => onOpen({ topic: slug, entity: r.entity, sentiment })} />
            </li>`)}
          </ul>`}
    </${J.Panel}>`
  }

  function CoordinationAlert({ slug, coordination, onOpen }) {
    const c = coordination.clusters[0]
    if (!c) return null
    return html`<section style=${delay(100)} className="anim-up flex flex-col gap-3 rounded-2xl border border-act/20 bg-act-soft p-5 sm:flex-row sm:items-center">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-act ring-1 ring-black/[0.06]"><${Icon} name="AlertTriangle" className="size-5" /></span>
      <div className="flex-1">
        <h2 className="font-semibold">Possible organised campaign</h2>
        <p className="text-sm text-muted-foreground">${c.posts} near-identical posts from ${c.posts === c.authors ? 'as many' : c.authors} different accounts appeared within about an hour (${formatIst(c.firstAt, 'datetime')}). Not confirmed. Example: “${c.sample}”</p>
      </div>
      <${Button} variant="outline" size="sm" className="shrink-0" onClick=${() => onOpen({ topic: slug, coordinated: true, window: '7d' })}>Review these posts</${Button}>
    </section>`
  }

  function TopPosts({ slug, filters, onOpen }) {
    const q = useQuery(() => J.api.getEvidence({ topic: slug, ...filters, window: '24h', sort: 'reach', limit: 6 }), [slug, filters.entity, filters.lane], { interval: 0 })
    return html`<section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Most-seen posts today</h2>
        <button type="button" onClick=${() => onOpen({ topic: slug, window: '24h', sort: 'reach' })} className="group inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-card px-3.5 py-1.5 text-sm font-medium shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all outline-none hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-[0_10px_24px_-12px_rgba(0,0,0,0.15)] focus-visible:ring-2 focus-visible:ring-ring">See all posts<${Icon} name="ArrowRight" className="size-3.5 text-muted-foreground transition-colors group-hover:text-brand" /></button>
      </div>
      ${!q.data
        ? html`<${Skeleton} className="h-32 rounded-2xl" />`
        : q.data.items.length === 0
          ? html`<p className="text-sm text-muted-foreground">No posts in the last day.</p>`
          : html`<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${q.data.items.slice(0, 6).map((it, i) => html`<${J.PostCard} key=${it.postId} item=${it} wait=${300 + i * 70} />`)}</div>`}
    </section>`
  }

  function TopicSkeleton() {
    return html`<div className="flex flex-col gap-4" aria-busy="true">
      <${Skeleton} className="h-5 w-24" /><${Skeleton} className="h-8 w-2/3" /><${Skeleton} className="h-4 w-full" />
      <${Skeleton} className="h-32 rounded-2xl" />
      <div className="grid gap-4 md:grid-cols-2"><${Skeleton} className="h-48 rounded-2xl" /><${Skeleton} className="h-48 rounded-2xl" /></div>
    </div>`
  }

  function TopicPage({ slug }) {
    const { filters } = useFilters()
    const open = J.useOpenEvidence()
    const q = useQuery(() => J.api.getTimeline(slug, filters), [slug, filters.entity, filters.lane])
    const back = `/${J.filterQuery(filters)}`
    if (q.data === null) {
      return html`<div className="flex flex-col gap-3 py-12 text-center"><h1 className="text-xl font-semibold">Topic not found</h1><${Link} href="/" className="text-sm underline underline-offset-4">Back to the overview</${Link}></div>`
    }
    if (!q.data) return q.isError ? html`<${ErrorPanel} text="Could not load this topic." onRetry=${q.refetch} />` : html`<${TopicSkeleton} />`
    const d = q.data
    const t = topicSummary(d, filters)
    return html`<div key=${`${filters.entity}-${filters.lane}`} className="flex flex-col gap-6">
      ${q.isError ? html`<${StaleBanner} asOf=${d.asOf} onRetry=${q.refetch} />` : null}
      <${TopicHeader} d=${d} t=${t} back=${back} />
      <${J.FilterBar} />
      <${WhatToDo} t=${t} />
      <${CoordinationAlert} slug=${slug} coordination=${d.coordination} onOpen=${open} />
      <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
        <${MoodPanel} t=${t} onOpen=${open} />
        <${WeekPanel} slug=${slug} name=${d.topic.name} days=${toDays(d.series)} onOpen=${open} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <${WherePanel} slug=${slug} rows=${d.bySource} onOpen=${open} />
        <${WhoPanel} slug=${slug} rows=${d.byEntity} onOpen=${open} />
      </div>
      <${TopPosts} slug=${slug} filters=${filters} onOpen=${open} />
    </div>`
  }

  Object.assign(J, { TopicPage })
})()
