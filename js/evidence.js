// Evidence drawer (components/evidence/*): the slice lives in the `evidence` URL param, one drawer
// is mounted for every page, and each card carries relabel controls (05-03) and the
// suspected-coordinated tag (06-02).
;(function () {
  const { html, cn, useState, useEffect, useRoute, navigate, hrefWith, parseFilters, Badge, Button, Select, Toggle, Sheet, Skeleton, Icon, formatIst, formatIstRange, formatCount, safeExternalUrl, toast } = J

  const SOURCE_BADGE = {
    x_api: 'X', x_apify: 'X (Apify)', youtube: 'YouTube', reddit: 'Reddit', news_rss: 'News', web_search: 'Web',
    apify_instagram: 'Instagram (sampled)', apify_linkedin: 'LinkedIn (sampled)', portal_chittorgarh: 'Chittorgarh',
    portal_investorgain: 'InvestorGain', portal_ipowatch: 'IPOWatch',
  }
  const sourceLabel = (k) => SOURCE_BADGE[k] ?? k
  const SourceBadge = ({ sourceKey }) => html`<${Badge} variant="outline" className="font-normal">${sourceLabel(sourceKey)}</${Badge}>`

  // --- slice.ts ----------------------------------------------------------------------------
  const KEYS = ['topic', 'topicName', 'sentiment', 'entity', 'window', 'from', 'to', 'source', 'confidence', 'coordinated', 'cluster', 'sort']
  const normalizeSlice = (s) => ({ ...s, window: s.window ?? '24h', sort: s.sort ?? 'reach' })
  function encodeSlice(input) {
    const s = normalizeSlice(input)
    const p = new URLSearchParams()
    for (const k of KEYS) if (s[k] !== undefined && s[k] !== '' && s[k] !== false) p.set(k, String(s[k]))
    return p.toString()
  }
  function decodeSlice(raw) {
    if (!raw) return null
    const p = new URLSearchParams(raw)
    const s = { window: p.get('window') ?? '24h', sort: p.get('sort') ?? 'reach' }
    if (!['24h', '7d'].includes(s.window) || !['reach', 'newest'].includes(s.sort)) return null
    for (const k of ['topic', 'topicName', 'sentiment', 'entity', 'from', 'to', 'source', 'confidence', 'cluster']) {
      const v = p.get(k)
      if (v !== null) s[k] = v
    }
    if (p.get('coordinated') === 'true') s.coordinated = true
    if (s.sentiment && !['positive', 'neutral', 'negative'].includes(s.sentiment)) return null
    if (s.entity && !J.ENTITY_KEYS.includes(s.entity) && !J.FILTER_ENTITIES.includes(s.entity)) return null
    return s
  }
  const RESERVED = { emerging: 'Emerging candidates', unclassified: 'Unclassified' }
  const SENT_LABEL = { positive: 'Positive', neutral: 'Neutral', negative: 'Negative' }
  const LANE_LABEL = { social: 'Public social', media: 'News and analysts' }
  const ENTITY_LABEL = { mukesh: 'Mukesh', akash: 'Akash', isha: 'Isha', jio: 'Jio', leadership: 'Leadership' }
  function describeSlice(slice, filters) {
    const parts = []
    if (slice.topic) parts.push(RESERVED[slice.topic] ?? slice.topicName ?? J.api.topicName(slice.topic))
    else if (!slice.sentiment) parts.push('All topics')
    if (slice.sentiment) parts.push(SENT_LABEL[slice.sentiment])
    if (slice.confidence === 'low') parts.push('Low confidence')
    if (slice.coordinated) parts.push('Suspected coordinated')
    if (slice.from && slice.to) parts.push(formatIstRange(slice.from, slice.to))
    else parts.push(slice.window === '24h' ? 'Last 24h' : 'Last 7 days')
    if (slice.source) parts.push(sourceLabel(slice.source))
    if (filters.lane !== 'all') parts.push(LANE_LABEL[filters.lane])
    const entity = slice.entity ?? filters.entity
    if (entity !== 'all') parts.push(ENTITY_LABEL[entity])
    return parts.join(', ')
  }
  function toEvidenceParams(slice, filters) {
    return { ...slice, entity: slice.entity ?? filters.entity, lane: filters.lane }
  }

  /** Returns open(sliceInput): writes the `evidence` param, keeping every other param. */
  function useOpenEvidence() {
    const route = useRoute()
    return (input) => {
      const next = new URLSearchParams(route.search)
      next.set('evidence', encodeSlice(input))
      navigate(hrefWith(route.path, next), { replace: true })
    }
  }
  function closeEvidence(route) {
    const next = new URLSearchParams(route.search)
    next.delete('evidence')
    navigate(hrefWith(route.path, next), { replace: true })
  }

  // --- relabel.tsx (05-03) -------------------------------------------------------------------
  const SENTIMENTS = [
    ['negative', 'Negative'],
    ['neutral', 'Neutral'],
    ['positive', 'Positive'],
  ]
  function RelabelControls({ item }) {
    const [cur, setCur] = useState({ sentiment: item.sentiment, topicSlug: item.topicSlug, entities: item.entities })
    useEffect(() => {
      setCur({ sentiment: item.sentiment, topicSlug: item.topicSlug, entities: item.entities })
    }, [item.postId])
    const topics = J.api.topicList()
    function apply(next) {
      const prev = cur
      setCur(next) // optimistic
      try {
        const res = J.api.relabel(item.postId, next)
        toast('Label saved', {
          duration: 10_000,
          action: {
            label: 'Undo',
            onClick: () => {
              J.api.undoLabel(res.classificationId)
              setCur(prev)
            },
          },
        })
      } catch {
        setCur(prev)
        toast('Could not save label', { error: true })
      }
    }
    return html`<div className="flex flex-wrap items-center gap-2 border-t pt-2">
      <div role="group" aria-label="Sentiment" className="flex">
        ${SENTIMENTS.map(
          ([s, label]) => html`<${Toggle}
            key=${s}
            pressed=${cur.sentiment === s}
            onClick=${() => cur.sentiment !== s && apply({ ...cur, sentiment: s })}
            className="rounded-none first:rounded-l-md last:rounded-r-md border-l-0 first:border-l"
          >${label}</${Toggle}>`,
        )}
      </div>
      <${Select}
        size="sm"
        aria-label="Topic"
        value=${cur.topicSlug}
        onValueChange=${(v) => apply({ ...cur, topicSlug: v })}
        options=${topics.map((t) => ({ value: t.slug, label: t.name }))}
        className="max-w-48 text-xs"
      />
      <div role="group" aria-label="Entities" className="flex gap-1">
        ${J.ENTITY_KEYS.map(
          (e) => html`<${Toggle}
            key=${e}
            pressed=${cur.entities.includes(e)}
            onClick=${() => apply({ ...cur, entities: cur.entities.includes(e) ? cur.entities.filter((x) => x !== e) : [...cur.entities, e] })}
          >${ENTITY_LABEL[e]}</${Toggle}>`,
        )}
      </div>
    </div>`
  }

  // --- evidence-card.tsx ---------------------------------------------------------------------
  function authorText(a) {
    if (!a.visible) return a.label
    if (a.displayName && a.handle) return `${a.displayName} (@${a.handle})`
    return a.displayName ?? (a.handle ? `@${a.handle}` : 'Unnamed')
  }
  const reachText = (s) => (s === null || !Number.isFinite(s) ? 'Reach -' : `Reach ${Math.round(Math.min(100, Math.max(0, s)))}`)

  function EvidenceCard({ item, relabel = true }) {
    const href = safeExternalUrl(item.url)
    return html`<article className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <${SourceBadge} sourceKey=${item.sourceKey} />
        <time dateTime=${item.publishedAt}>${formatIst(item.publishedAt, 'datetime')} IST</time>
        <span>${reachText(item.reachScore)}</span>
        ${item.confidence === 'low' ? html`<${Badge} variant="outline" className="border-amber-500/50 text-amber-800 dark:text-amber-300">Low confidence</${Badge}>` : null}
        ${item.suspectedCoordinated ? html`<${Badge} variant="outline" className="border-rose-500/50 text-rose-800 dark:text-rose-300">Suspected coordinated</${Badge}>` : null}
        ${item.origin === 'correction' ? html`<${Badge} variant="secondary" className="font-normal">Relabelled</${Badge}>` : null}
      </div>
      <p className=${cn("break-words whitespace-pre-wrap", relabel === false && "line-clamp-4")} title=${relabel === false ? item.text.slice(0, 600) : undefined}>${item.text}</p>
      ${item.lang !== 'en' && item.glossEn ? html`<p className="text-xs text-muted-foreground">EN: ${item.glossEn}</p>` : null}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">${authorText(item.author)}</span>
        ${href
          ? html`<a href=${href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline">
              Open original <${Icon} name="ExternalLink" className="size-3" />
            </a>`
          : null}
      </div>
      ${relabel ? html`<${RelabelControls} item=${item} />` : null}
    </article>`
  }

  // --- Compact post card (topic page and drawer) ----------------------------------------------
  const PLATFORM = {
    x: { label: 'X', fill: ['M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'] },
    youtube: { label: 'YouTube', fill: ['M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z'] },
    reddit: { label: 'Reddit', fill: ['M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z'] },
    instagram: { label: 'Instagram', stroke: ['M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5z', 'M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z', 'M17.5 6.5h.01'] },
    linkedin: { label: 'LinkedIn', fill: ['M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 4.981v6.248zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zM7.119 20.452H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z'] },
    web: { label: 'News', stroke: ['M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20', 'M2 12h20', 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20'] },
  }
  const platformOf = (key) =>
    key.startsWith('x_') ? 'x' : key === 'youtube' ? 'youtube' : key === 'reddit' ? 'reddit' : key === 'apify_instagram' ? 'instagram' : key === 'apify_linkedin' ? 'linkedin' : 'web'
  function PlatformIcon({ sourceKey, className }) {
    const p = PLATFORM[platformOf(sourceKey)]
    return html`<span className=${cn('grid size-8 shrink-0 place-items-center rounded-xl bg-muted text-foreground', className)} title=${p.label}>
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true" fill=${p.fill ? 'currentColor' : 'none'} stroke=${p.stroke ? 'currentColor' : 'none'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        ${(p.fill ?? p.stroke).map((d, i) => html`<path key=${i} d=${d} />`)}
      </svg>
    </span>`
  }
  /** First meaningful line of a post: drops URLs, hashtag-only lines and the outlet suffix. */
  function headlineOf(text) {
    const lines = text.split(/\n+/).map((l) => l.replace(/https?:\/\/\S+/g, '').trim()).filter((l) => l && !/^(#\S+\s*)+$/.test(l))
    return (lines[0] ?? text).replace(/\s+-\s+[^-]{2,40}$/, '')
  }
  const ago = (iso) => {
    const m = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000)
    return m < 60 ? `${Math.round(m)}m ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`
  }
  const MOOD_DOT = { positive: 'bg-good', neutral: 'bg-calm', negative: 'bg-act' }

  /** Compact post card: platform icon, author and age, a two-line headline, mood and reach. The whole
   *  card opens the original; `editable` adds a "Correct label" toggle with the relabel controls. */
  function PostCard({ item, editable = false, wait = null }) {
    const [fixing, setFixing] = useState(false)
    const p = PLATFORM[platformOf(item.sourceKey)]
    const who = item.author.visible ? item.author.displayName ?? item.author.handle : null
    const href = safeExternalUrl(item.url)
    const flags = [
      item.suspectedCoordinated && ['Suspected coordinated', 'bg-act-soft text-act'],
      item.confidence === 'low' && ['Low confidence', 'bg-muted text-muted-foreground'],
      item.origin === 'correction' && ['Relabelled', 'bg-brand-soft text-brand'],
    ].filter(Boolean)
    return html`<article style=${wait === null ? undefined : J.delay(wait)} className="${wait === null ? '' : 'anim-up '}group relative flex flex-col gap-2.5 rounded-2xl border border-black/[0.06] bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-[0_10px_24px_-12px_rgba(0,0,0,0.15)]">
      ${href ? html`<a href=${href} target="_blank" rel="noopener noreferrer nofollow" className="absolute inset-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label=${`Open original: ${headlineOf(item.text).slice(0, 80)}`} />` : null}
      <div className="flex items-center gap-2.5">
        <${PlatformIcon} sourceKey=${item.sourceKey} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-medium">${who ?? p.label}</div>
          <div className="text-xs text-muted-foreground">${who ? `${p.label} · ` : ''}${ago(item.publishedAt)}</div>
        </div>
        <${Icon} name="ExternalLink" className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <p className="line-clamp-2 text-sm leading-snug" title=${item.text.slice(0, 400)}>${headlineOf(item.text)}</p>
      ${item.lang !== 'en' && item.glossEn ? html`<p className="line-clamp-1 text-xs text-muted-foreground">EN: ${item.glossEn}</p>` : null}
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className=${cn('size-2 rounded-full', MOOD_DOT[item.sentiment])} />${SENT_LABEL[item.sentiment]}</span>
        ${flags.map(([label, c]) => html`<span key=${label} className=${cn('rounded-full px-2 py-0.5 font-medium', c)}>${label}</span>`)}
        <span className="ml-auto tabular-nums" title="Reach score, 0-100">${reachText(item.reachScore)}</span>
        ${editable
          ? html`<button type="button" onClick=${() => setFixing(!fixing)} aria-expanded=${fixing}
              className="relative z-10 rounded-full border border-black/[0.08] bg-card px-2.5 py-0.5 font-medium text-foreground hover:border-brand/40">${fixing ? 'Done' : 'Correct label'}</button>`
          : null}
      </div>
      ${editable && fixing ? html`<div className="relative z-10 border-t pt-3"><${RelabelControls} item=${item} /></div>` : null}
    </article>`
  }

  function CardSkeleton() {
    return html`<div className="flex flex-col gap-2.5 rounded-2xl border border-black/[0.06] bg-card p-4" aria-hidden="true">
      <${Skeleton} className="h-4 w-1/3" /><${Skeleton} className="h-4 w-full" /><${Skeleton} className="h-4 w-2/3" />
    </div>`
  }

  // --- evidence-drawer.tsx -------------------------------------------------------------------
  function EvidencePanel({ slice, filters }) {
    const open = useOpenEvidence()
    const key = encodeSlice(slice) + JSON.stringify(filters)
    const [pages, setPages] = useState(null)
    const [loadingMore, setLoadingMore] = useState(false)
    useEffect(() => {
      setPages(null)
      const t = setTimeout(() => setPages([J.api.getEvidence(toEvidenceParams(slice, filters))]), 260)
      return () => clearTimeout(t)
    }, [key])
    // A saved label invalidates the evidence query: refetch the pages already loaded, in place.
    useEffect(
      () =>
        J.store.subscribe(() =>
          setPages((ps) => {
            if (!ps) return ps
            const loaded = ps.reduce((a, p) => a + p.items.length, 0)
            const page = J.api.getEvidence({ ...toEvidenceParams(slice, filters), limit: Math.max(20, loaded) })
            return [{ ...page, nextCursor: page.nextCursor }]
          }),
        ),
      [key],
    )
    const items = (pages ?? []).flatMap((p) => p.items)
    const total = pages?.[0]?.total
    const next = pages?.[pages.length - 1]?.nextCursor
    function loadMore() {
      setLoadingMore(true)
      setTimeout(() => {
        setPages((ps) => [...ps, J.api.getEvidence({ ...toEvidenceParams(slice, filters), cursor: next })])
        setLoadingMore(false)
      }, 250)
    }
    return html`<${J.Fragment}>
      <div className="flex flex-col gap-1.5 border-b p-4 pr-12">
        <h2 className="font-semibold text-foreground">${describeSlice(slice, filters)}</h2>
        <p className="text-sm text-muted-foreground">${total === undefined ? 'Loading posts' : `${formatCount(total)} items`}</p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span id="evidence-sort-label" className="text-xs text-muted-foreground">Sort by</span>
          <${Select}
            size="sm"
            aria-labelledby="evidence-sort-label"
            value=${slice.sort}
            onValueChange=${(v) => open({ ...slice, sort: v })}
            options=${[{ value: 'reach', label: 'Reach' }, { value: 'newest', label: 'Newest' }]}
          />
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" className="size-3.5 accent-current" checked=${!!slice.coordinated} onChange=${(e) => open({ ...slice, coordinated: e.target.checked || undefined })} />
            Suspected coordinated only
          </label>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto bg-background p-4">
        ${pages === null ? html`<${CardSkeleton} /><${CardSkeleton} /><${CardSkeleton} />` : null}
        ${pages !== null && items.length === 0 ? html`<p className="py-8 text-center text-sm text-muted-foreground">No posts match this slice</p>` : null}
        ${items.map((item, i) => html`<${PostCard} key=${item.postId} item=${item} editable wait=${Math.min(i, 10) * 50} />`)}
        ${next ? html`<${Button} variant="outline" onClick=${loadMore} disabled=${loadingMore}>${loadingMore ? html`<${Icon} name="Loader2" className="animate-spin" />` : null}Load more</${Button}>` : null}
      </div>
    </${J.Fragment}>`
  }

  function EvidenceDrawer() {
    const route = useRoute()
    const slice = decodeSlice(route.params.get('evidence'))
    const filters = parseFilters(route.params)
    return html`<${Sheet} open=${slice !== null} onClose=${() => closeEvidence(route)} className="w-full gap-0 sm:max-w-xl">
      ${slice ? html`<${EvidencePanel} slice=${slice} filters=${filters} />` : null}
    </${Sheet}>`
  }

  Object.assign(J, { SourceBadge, sourceLabel, EvidenceCard, PostCard, PlatformIcon, EvidenceDrawer, useOpenEvidence, encodeSlice, ENTITY_LABEL, SENT_LABEL })
})()
