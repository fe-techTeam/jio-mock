// Accuracy (/accuracy, PLAN-05-03): gold-set figures, per-language table, confusion matrix and
// the labelling queue. It starts at 0 of 200: the figures appear once 200 posts are labelled.
;(function () {
  const { html, cn, useState, useEffect, useFilters, useQuery, Badge, Button, Select, Toggle, Table, THead, TBody, Tr, Th, Td, Skeleton, BackLink, Icon, formatIst, formatCount, safeExternalUrl, filterQuery, toast } = J

  const pct = (x) => (x === null || x === undefined ? 'n/a' : `${Math.round(x * 100)}%`)
  const SENTS = ['negative', 'neutral', 'positive']

  function GoldQueue({ acc }) {
    const [item, setItem] = useState(() => J.api.goldQueueItem())
    const [label, setLabel] = useState(null)
    useEffect(() => {
      if (item) setLabel({ sentiment: item.sentiment, topicSlug: item.topicSlug, entities: item.entities, sarcastic: false })
    }, [item?.postId])
    useEffect(() => {
      const onKey = (e) => {
        if (!item || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return
        const s = { 1: 'negative', 2: 'neutral', 3: 'positive' }[e.key]
        if (s) setLabel((l) => ({ ...l, sentiment: s }))
      }
      document.addEventListener('keydown', onKey)
      return () => document.removeEventListener('keydown', onKey)
    }, [item?.postId])

    if (!item) {
      return acc.labelled >= 200
        ? html`<div className="flex flex-col items-start gap-2 rounded-lg border p-4"><p className="font-medium">Gold set complete</p><p className="text-sm text-muted-foreground">All 200 posts are labelled and scored against ${acc.promptVersion}.</p><${Button} size="sm" variant="outline" onClick=${() => toast('Re-scored: 0 of 200 not yet re-classified with prompt v3')}><${Icon} name="RefreshCw" />Re-score</${Button}></div>`
        : html`<p className="text-sm text-muted-foreground">No live posts to label yet</p>`
    }
    if (!label) return null
    const href = safeExternalUrl(item.url)
    function saveNext() {
      const res = J.api.saveGold(item.postId, label)
      if (!res.ok) return toast('Gold set complete')
      toast('Gold label saved')
      setItem(J.api.goldQueueItem())
    }
    return html`<div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <${J.SourceBadge} sourceKey=${item.sourceKey} />
        <span>${formatIst(item.publishedAt, 'datetime')} IST</span>
        <${Badge} variant="secondary" className="font-normal">${item.lang}</${Badge}>
        ${href ? html`<a href=${href} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline">Open original <${Icon} name="ExternalLink" className="size-3" /></a>` : null}
      </div>
      <p className="text-base">${item.text}</p>
      ${item.glossEn ? html`<p className="text-sm text-muted-foreground">EN: ${item.glossEn}</p>` : null}
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Sentiment" className="flex">
          ${SENTS.map((s, i) => html`<${Toggle} key=${s} pressed=${label.sentiment === s} onClick=${() => setLabel({ ...label, sentiment: s })} className="rounded-none border-l-0 first:rounded-l-md first:border-l last:rounded-r-md">${i + 1} ${J.SENT_LABEL[s]}</${Toggle}>`)}
        </div>
        <${Select} size="sm" value=${label.topicSlug} onValueChange=${(v) => setLabel({ ...label, topicSlug: v })} options=${J.api.topicList().map((t) => ({ value: t.slug, label: t.name }))} className="max-w-60 text-xs" />
        <div className="flex gap-1">${J.ENTITY_KEYS.map((e) => html`<${Toggle} key=${e} pressed=${label.entities.includes(e)} onClick=${() => setLabel({ ...label, entities: label.entities.includes(e) ? label.entities.filter((x) => x !== e) : [...label.entities, e] })}>${J.ENTITY_LABEL[e]}</${Toggle}>`)}</div>
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked=${label.sarcastic} onChange=${(e) => setLabel({ ...label, sarcastic: e.target.checked })} />Sarcastic</label>
      </div>
      <div className="flex gap-2">
        <${Button} size="sm" onClick=${saveNext}>Save and next</${Button}>
        <${Button} size="sm" variant="outline" onClick=${() => { J.api.skipGold(item.postId); setItem(J.api.goldQueueItem()) }}>Skip</${Button}>
        <span className="ml-auto self-center text-xs text-muted-foreground">Keys 1, 2, 3 set sentiment</span>
      </div>
    </div>`
  }

  function AccuracyPage() {
    const { filters } = useFilters()
    const q = useQuery(() => J.api.getAccuracy(), [], { interval: 0, delay: 150 })
    if (!q.data) return html`<div className="flex flex-col gap-3"><${Skeleton} className="h-10 w-1/2" /><${Skeleton} className="h-48" /></div>`
    const a = q.data
    const langLabel = { en: 'EN', hinglish: 'Hinglish', hi: 'Hindi', gu: 'Gujarati' }
    return html`<div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <${BackLink} href=${`/${filterQuery(filters)}`} />
        <h1 className="text-2xl font-semibold">Accuracy</h1>
        ${a.measured
          ? html`<div className="flex flex-wrap gap-6"><div><div className="text-xs text-muted-foreground">Sentiment</div><div className="text-3xl font-semibold tabular-nums">${pct(a.overall.sentiment)}</div></div><div><div className="text-xs text-muted-foreground">Topic</div><div className="text-3xl font-semibold tabular-nums">${pct(a.overall.topic)}</div></div></div>`
          : html`<p className="text-lg">Not measured yet: ${a.labelled} of 200 labelled</p>`}
        <p className="text-xs text-muted-foreground">Classifier: ${a.promptVersion}. Measured only on the gold set, never on dashboard corrections.</p>
      </header>

      ${a.measured
        ? html`<div className="grid gap-4 lg:grid-cols-2">
            <section className="flex flex-col gap-2 rounded-lg border p-4">
              <h2 className="text-sm font-medium">By language</h2>
              <${Table}><${THead}><${Tr}><${Th}>Language</${Th}><${Th} className="text-right">n</${Th}><${Th} className="text-right">Sentiment</${Th}><${Th} className="text-right">Topic</${Th}></${Tr}></${THead}>
                <${TBody}>${a.byLang.map((r) => html`<${Tr} key=${r.lang}><${Td}>${r.label}</${Td}><${Td} className="text-right tabular-nums">${r.n}</${Td}><${Td} className="text-right tabular-nums">${pct(r.sentiment)}</${Td}><${Td} className="text-right tabular-nums">${pct(r.topic)}</${Td}></${Tr}>`)}</${TBody}>
              </${Table}>
              <p className="text-xs text-muted-foreground">Sarcasm subset: ${a.sarcasm.n} posts, sentiment ${pct(a.sarcasm.sentiment)}</p>
            </section>
            <section className="flex flex-col gap-2 rounded-lg border p-4">
              <h2 className="text-sm font-medium">Sentiment confusion (rows: gold, columns: model)</h2>
              <${Table}><${THead}><${Tr}><${Th} />${SENTS.map((s) => html`<${Th} key=${s} className="text-right">${J.SENT_LABEL[s]}</${Th}>`)}<${Th} className="text-right">Total</${Th}></${Tr}></${THead}>
                <${TBody}>${a.confusion.map((row, i) => html`<${Tr} key=${i}><${Td} className="font-medium">${J.SENT_LABEL[SENTS[i]]}</${Td}>${row.map((v, j) => html`<${Td} key=${j} className=${cn('text-right tabular-nums', i === j && 'bg-blue-500/10 font-semibold')}>${v}</${Td}>`)}<${Td} className="text-right tabular-nums text-muted-foreground">${row.reduce((x, y) => x + y, 0)}</${Td}></${Tr}>`)}</${TBody}>
              </${Table}>
            </section>
          </div>`
        : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Labelling queue</h2>
          <span className="text-sm tabular-nums">${a.labelled} / 200 <span className="text-xs text-muted-foreground">(${Object.entries(a.byLangCounts).map(([k, v]) => `${langLabel[k]} ${v}`).join(', ')})</span></span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style=${{ width: `${(a.labelled / 200) * 100}%` }} /></div>
        <${GoldQueue} acc=${a} />
      </section>

      <section className="rounded-lg border p-4 text-sm">
        <span className="font-medium">${formatCount(a.corrections.total)} dashboard relabels</span>, ${a.corrections.fewShot} used as few-shot examples in the classifier prompt.
      </section>
    </div>`
  }

  Object.assign(J, { AccuracyPage })
})()
