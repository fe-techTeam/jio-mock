// Settings (/settings, PLAN-05-02): Keywords and entities / Topics / Access and retention tabs.
;(function () {
  const { html, cn, useState, useRoute, useFilters, useQuery, navigate, hrefWith, Badge, Button, Input, Select, Table, THead, TBody, Tr, Th, Td, Skeleton, Icon, BackLink, Link, formatIst, formatCount, filterQuery, toast } = J

  const TABS = [
    ['keywords', 'Keywords and entities'],
    ['topics', 'Topics'],
    ['access', 'Access and retention'],
  ]

  function TermListEditor({ label, hint, terms, onChange, error }) {
    const [draft, setDraft] = useState('')
    function add() {
      const t = draft.trim()
      if (!t || terms.some((x) => x.toLowerCase() === t.toLowerCase())) return setDraft('')
      onChange([...terms, t])
      setDraft('')
    }
    return html`<div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">${label}</span>
        <span className="text-xs text-muted-foreground">${terms.length} terms${hint ? ` · ${hint}` : ''}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        ${terms.map((t) => html`<span key=${t} className="inline-flex items-center gap-1 rounded-full border bg-secondary py-0.5 pr-1 pl-2.5 text-xs">
          ${t}
          <button type="button" aria-label=${`Remove ${t}`} onClick=${() => onChange(terms.filter((x) => x !== t))} className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"><${Icon} name="X" className="size-3" /></button>
        </span>`)}
      </div>
      <${Input} className="h-8" placeholder="Add a term and press Enter" value=${draft} onChange=${(e) => setDraft(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
      ${error ? html`<span className="text-xs text-destructive">${error}</span>` : null}
    </div>`
  }

  function KeywordsTab() {
    const base = J.api.getConfig()
    const [draft, setDraft] = useState(base.terms)
    const [baseVersion, setBaseVersion] = useState(base.version)
    const [test, setTest] = useState(null)
    const [saveState, setSaveState] = useState(null)
    const dirty = JSON.stringify(draft) !== JSON.stringify(J.api.getConfig().terms)
    const errors = J.api.validateTerms(draft)
    const setList = (k) => (v) => setDraft({ ...draft, [k]: v })
    const setAliases = (e) => (v) => setDraft({ ...draft, entities: { ...draft.entities, [e]: { ...draft.entities[e], aliases: v } } })
    function save() {
      const res = J.api.saveTerms(draft, baseVersion)
      if (res.ok) {
        setBaseVersion(res.version)
        setSaveState(null)
        setTest(null)
        toast(`Saved as config v${res.version}`)
      } else setSaveState(res.status === 409 ? 'conflict' : 'error')
    }
    return html`<div className="flex flex-col gap-4">
      ${dirty
        ? html`<div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-background p-3 shadow-sm">
            <span className="text-sm font-medium">Unsaved changes</span>
            ${test ? html`<span className="text-xs text-muted-foreground">Current: ${formatCount(test.current)}, draft: ${formatCount(test.draft)} of ${formatCount(test.total)} posts in the last 24h</span>` : null}
            <div className="ml-auto flex gap-2">
              <${Button} size="sm" variant="outline" onClick=${() => setTest(J.api.testTerms(draft))}>Test against last 24h</${Button}>
              <${Button} size="sm" variant="ghost" onClick=${() => { setDraft(J.api.getConfig().terms); setTest(null) }}>Discard</${Button}>
              <${Button} size="sm" disabled=${Object.keys(errors).length > 0} onClick=${save}>Save</${Button}>
            </div>
            ${saveState === 'conflict' ? html`<p className="w-full text-xs text-destructive">Config changed since you opened it, reload</p>` : null}
            ${test && test.samples.length ? html`<ul className="w-full list-disc pl-5 text-xs text-muted-foreground">${test.samples.map((s, i) => html`<li key=${i} className="line-clamp-1">${s}</li>`)}</ul>` : null}
          </div>`
        : null}
      <div className="grid gap-3 lg:grid-cols-2">
        <${TermListEditor} label="IPO terms" hint="match alone" terms=${draft.ipo_terms} onChange=${setList('ipo_terms')} error=${errors.ipo_terms} />
        <${TermListEditor} label="Hashtags" hint="match alone" terms=${draft.hashtags} onChange=${setList('hashtags')} error=${errors.hashtags} />
        <${TermListEditor} label="Co-occurrence terms" hint="qualify 'jio', 'Reliance', 'Ambani'" terms=${draft.cooccurrence_terms} onChange=${setList('cooccurrence_terms')} error=${errors.cooccurrence_terms} />
        <${TermListEditor} label="Negative terms" hint="masked first" terms=${draft.negative_terms} onChange=${setList('negative_terms')} error=${errors.negative_terms} />
      </div>
      <h3 className="pt-2 text-sm font-medium">Entities and aliases (Latin, Devanagari, Gujarati)</h3>
      <div className="grid gap-3 lg:grid-cols-2">
        ${['mukesh', 'akash', 'isha', 'jio'].map((e) => html`<${TermListEditor} key=${e} label=${draft.entities[e].label} terms=${draft.entities[e].aliases} onChange=${setAliases(e)} error=${errors[`entity:${e}`]} />`)}
      </div>
    </div>`
  }

  function SeedTopicRow({ t }) {
    const [edit, setEdit] = useState(false)
    const [name, setName] = useState(t.name)
    const [desc, setDesc] = useState(t.description)
    return html`<div className="flex flex-col gap-2 rounded-lg border p-3">
      ${edit
        ? html`<${Input} value=${name} onChange=${(e) => setName(e.target.value)} />
            <textarea className="min-h-16 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" value=${desc} onChange=${(e) => setDesc(e.target.value)} />
            <div className="flex gap-2"><${Button} size="xs" onClick=${() => { J.api.updateTopic(t.slug, { name, description: desc }); setEdit(false); toast('Topic saved') }}>Save</${Button}><${Button} size="xs" variant="ghost" onClick=${() => setEdit(false)}>Cancel</${Button}></div>`
        : html`<div className="flex items-start justify-between gap-2">
              <div><div className="font-medium">${t.name}</div><p className="text-xs text-muted-foreground">${t.description}</p></div>
              <${Button} size="xs" variant="outline" onClick=${() => setEdit(true)}>Edit</${Button}>
            </div>`}
      ${t.examplePhrases?.length ? html`<div className="flex flex-wrap gap-1">${t.examplePhrases.map((p) => html`<${Badge} key=${p} variant="secondary" className="font-normal whitespace-normal">${p}</${Badge}>`)}</div>` : null}
    </div>`
  }

  function EmergingCard({ c, seeds }) {
    const [name, setName] = useState(c.name)
    const [mergeInto, setMergeInto] = useState(seeds[0]?.slug)
    return html`<div className="flex flex-col gap-3 rounded-lg border border-dashed p-3">
      <div className="flex flex-wrap items-center gap-2"><span className="font-medium">${c.name}</span><${Badge} variant="secondary">${c.items} ${c.items === 1 ? 'item' : 'items'}</${Badge}></div>
      <div className="flex flex-col gap-2">${c.samples.map((s) => html`<div key=${s.postId} className="rounded-md bg-muted/40 p-2 text-xs"><p>${s.text}</p>${s.lang !== 'en' && s.glossEn ? html`<p className="text-muted-foreground">EN: ${s.glossEn}</p>` : null}</div>`)}</div>
      <div className="flex flex-wrap items-center gap-2">
        <${Input} className="h-8 max-w-xs" value=${name} onChange=${(e) => setName(e.target.value)} aria-label="Name when promoted" />
        <${Button} size="sm" onClick=${() => { J.api.promote(c.id, name); toast(`Promoted "${name}". It appears on the brief once it has 10 items in 24h.`) }}>Promote</${Button}>
        <span className="text-xs text-muted-foreground">or</span>
        <${Select} size="sm" value=${mergeInto} onValueChange=${setMergeInto} options=${seeds.map((s) => ({ value: s.slug, label: s.name }))} className="max-w-56" />
        <${Button} size="sm" variant="outline" onClick=${() => { J.api.merge(c.id, mergeInto); toast('Merged') }}>Merge into</${Button}>
        <${Button} size="sm" variant="ghost" onClick=${() => confirm(`Dismiss "${c.name}"?`) && (J.api.dismiss(c.id), toast('Dismissed'))}>Dismiss</${Button}>
      </div>
    </div>`
  }

  function TopicsTab() {
    const q = useQuery(() => J.api.getTopicsAdmin(), [], { interval: 0, delay: 120 })
    if (!q.data) return html`<${Skeleton} className="h-64" />`
    const { seeds, emerging, unclassified24h } = q.data
    return html`<div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Emerging candidates</h3>
        ${emerging.length === 0 ? html`<p className="text-sm text-muted-foreground">Nothing new outside the 10 topics</p>` : emerging.map((c) => html`<${EmergingCard} key=${c.id} c=${c} seeds=${seeds} />`)}
        <p className="text-sm text-muted-foreground">Unclassified in the last 24h: <span className="font-medium text-foreground">${formatCount(unclassified24h)}</span></p>
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Talking points (${seeds.length})</h3>
        <div className="grid gap-3 lg:grid-cols-2">${seeds.map((t) => html`<${SeedTopicRow} key=${t.slug + t.name} t=${t} />`)}</div>
      </section>
    </div>`
  }

  function AccessTab() {
    const cfg = J.api.getConfig()
    const [ret, setRet] = useState(cfg.retention)
    const [thr, setThr] = useState({ split: cfg.min_items_for_split, active: cfg.active_min_items_24h })
    const [err, setErr] = useState(null)
    const [offset, setOffset] = useState(8)
    const audit = J.api.getAudit(0, offset)
    function save() {
      const res = J.api.saveSettings({ retention: ret, min_items_for_split: thr.split, active_min_items_24h: thr.active }, J.api.getConfig().version)
      if (res.ok) { setErr(null); toast(`Saved as config v${res.version}`) } else setErr(res.errors ? Object.values(res.errors)[0] : 'Could not save')
    }
    const num = (v, set) => html`<${Input} className="h-8 w-20 text-right tabular-nums" inputMode="numeric" value=${v} onChange=${(e) => set(Number(e.target.value) || 0)} />`
    return html`<div className="flex flex-col gap-6">
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <h3 className="text-sm font-medium">Retention (days)</h3>
          <label className="flex items-center justify-between gap-2 text-sm">Raw payloads ${num(ret.raw_json, (v) => setRet({ ...ret, raw_json: v }))}</label>
          <label className="flex items-center justify-between gap-2 text-sm">Post text ${num(ret.post_text, (v) => setRet({ ...ret, post_text: v }))}</label>
          <label className="flex items-center justify-between gap-2 text-sm">Author rows ${num(ret.authors, (v) => setRet({ ...ret, authors: v }))}</label>
          <p className="text-xs text-muted-foreground">Rollups and market points: kept indefinitely</p>
        </div>
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <h3 className="text-sm font-medium">Thresholds</h3>
          <label className="flex items-center justify-between gap-2 text-sm">Minimum items for a sentiment split ${num(thr.split, (v) => setThr({ ...thr, split: v }))}</label>
          <label className="flex items-center justify-between gap-2 text-sm">Active topic: items in 24h ${num(thr.active, (v) => setThr({ ...thr, active: v }))}</label>
          <div className="mt-auto flex items-center justify-between gap-2 rounded-md bg-muted/50 p-2 text-sm">
            <span className="flex items-center gap-2"><${Icon} name="Lock" className="size-3.5" />Person-level views: Off, pending legal review</span>
            <button type="button" role="switch" aria-checked="false" disabled className="inline-flex h-5 w-9 cursor-not-allowed items-center rounded-full bg-input p-0.5 opacity-60"><span className="size-4 rounded-full bg-background shadow" /></button>
          </div>
        </div>
      </section>
      <div className="flex items-center gap-3"><${Button} size="sm" onClick=${save}>Save</${Button}>${err ? html`<span className="text-xs text-destructive">${err}</span>` : null}</div>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Audit log</h3>
        <${Table}>
          <${THead}><${Tr}><${Th}>Time (IST)</${Th}><${Th}>Action</${Th}><${Th}>IP</${Th}><${Th}>Detail</${Th}></${Tr}></${THead}>
          <${TBody}>${audit.items.length === 0 ? html`<tr><td colSpan="4" className="p-3 text-sm text-muted-foreground">No data yet: nothing has happened in this session</td></tr>` : null}${audit.items.map((a, i) => html`<${Tr} key=${i}><${Td} className="tabular-nums">${formatIst(new Date(a.at).toISOString(), 'datetime')}</${Td}><${Td}><${Badge} variant="outline" className="font-normal">${a.kind}</${Badge}></${Td}><${Td} className="tabular-nums text-muted-foreground">${a.ip}</${Td}><${Td} className="whitespace-normal text-muted-foreground">${a.detail}</${Td}></${Tr}>`)}</${TBody}>
        </${Table}>
        ${audit.nextCursor ? html`<${Button} variant="outline" size="sm" className="w-fit" onClick=${() => setOffset(offset + 8)}>Load more</${Button}>` : null}
      </section>
    </div>`
  }

  function SettingsPage() {
    const route = useRoute()
    const { filters } = useFilters()
    const tab = TABS.some(([k]) => k === route.params.get('tab')) ? route.params.get('tab') : 'keywords'
    const tabHref = (k) => {
      const p = new URLSearchParams(route.search)
      if (k === 'keywords') p.delete('tab')
      else p.set('tab', k)
      return hrefWith('/settings', p)
    }
    return html`<div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <${BackLink} href=${`/${filterQuery(filters)}`} />
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-xs text-muted-foreground">Config v${J.api.getConfig().version}, saved ${formatIst(new Date(J.api.getConfig().savedAt).toISOString(), 'datetime')} IST</p>
      </header>
      <nav aria-label="Settings" className="inline-flex w-fit items-center rounded-lg bg-muted p-[3px]">
        ${TABS.map(([k, label]) => html`<${Link} key=${k} href=${tabHref(k)} aria-current=${tab === k ? 'page' : undefined} className=${cn('rounded-md px-3 py-1 text-sm font-medium transition', tab === k ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>${label}</${Link}>`)}
      </nav>
      ${tab === 'keywords' ? html`<${KeywordsTab} />` : tab === 'topics' ? html`<${TopicsTab} />` : html`<${AccessTab} />`}
    </div>`
  }

  Object.assign(J, { SettingsPage })
})()
