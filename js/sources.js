// Sources page (/sources): what the scrape behind this snapshot returned, per source. Intervals,
  // X tier and YouTube quota are not recorded in the scraped output, so they are not shown.
;(function () {
  const { html, cn, useState, useFilters, useQuery, Badge, Button, Table, THead, TBody, Tr, Th, Td, Skeleton, Icon, BackLink, ErrorPanel, formatIst, formatCount, formatUsd, filterQuery } = J

  const ist = (iso) => formatIst(iso, 'datetime')
  const COVERAGE = { full_search: 'full search', sampled: 'sampled, not representative', scraped: 'scraped' }

  function StatusBadge({ row }) {
    if (row.status === 'skipped') return html`<${Badge} variant="outline" className="font-normal text-muted-foreground" title=${row.lastError ?? ''}>Skipped</${Badge}>`
    if (row.status === 'partial') return html`<${Badge} variant="outline" className="border-amber-500/50 text-amber-800 dark:text-amber-300" title=${row.lastError ?? ''}>Partial</${Badge}>`
    if (row.status === 'ok') return html`<${Badge} variant="outline" className="border-blue-600/40 text-blue-700">OK</${Badge}>`
    return html`<${Badge} variant="outline" className="border-rose-500/50 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300" title=${row.lastError ?? ''}>${row.status === 'none' ? 'No data yet' : row.status}</${Badge}>`
  }

  function Runs({ sourceKey }) {
    const runs = J.api.sourceRuns(sourceKey)
    if (runs.length === 0) return html`<p className="text-sm text-muted-foreground">No data yet: this source did not run.</p>`
    return html`<div className="rounded-md bg-muted/40 p-3">
      <${Table}>
        <${THead}><${Tr}><${Th}>Run (IST)</${Th}><${Th}>Status</${Th}><${Th} className="text-right">Items</${Th}><${Th} className="text-right">Cost</${Th}><${Th}>Error</${Th}></${Tr}></${THead}>
        <${TBody}>${runs.map((r, i) => html`<${Tr} key=${i}>
          <${Td} className="tabular-nums">${ist(r.at)}</${Td}>
          <${Td}>${r.status === 'ok' ? html`<span className="text-blue-700">ok</span>` : html`<span className="text-amber-800 dark:text-amber-300">${r.status}</span>`}</${Td}>
          <${Td} className="text-right tabular-nums">${r.itemsNew}</${Td}>
          <${Td} className="text-right tabular-nums">${formatUsd(r.costUsd)}</${Td}>
          <${Td} className="max-w-md text-xs whitespace-normal text-muted-foreground">${r.error ?? ''}</${Td}>
        </${Tr}>`)}</${TBody}>
      </${Table}>
    </div>`
  }

  function SourcesPage() {
    const { filters } = useFilters()
    const [open, setOpen] = useState(null)
    const q = useQuery(() => ({ rows: J.api.sourceRows(), run: J.api.runInfo() }), [])
    if (!q.data) return q.isError ? html`<${ErrorPanel} text="Could not load sources." onRetry=${q.refetch} /> ` : html`<div className="flex flex-col gap-3">${Array.from({ length: 8 }, (_, i) => html`<${Skeleton} key=${i} className="h-10" />`)}</div>`
    const { rows, run } = q.data
    const total = rows.reduce((a, r) => a + r.spendUsd, 0)
    return html`<div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <${BackLink} href=${`/${filterQuery(filters)}`} />
        <h1 className="text-2xl font-semibold">Sources</h1>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span>Snapshot run <span className="font-medium text-foreground tabular-nums">${run.runId}</span></span>
          <span>${formatCount(run.posts)} posts, ${formatCount(run.marketPoints)} GMP points</span>
          <span>Spend <span className="font-medium text-foreground tabular-nums">${formatUsd(total)}</span></span>
        </div>
      </header>
      <${Table} className="min-w-[900px]">
        <${THead}><${Tr}>
          <${Th} />
          <${Th}>Source</${Th}><${Th}>Lane</${Th}><${Th}>Status</${Th}><${Th}>Fetched</${Th}>
          <${Th} className="text-right">Items in snapshot</${Th}><${Th} className="text-right">Items 24h</${Th}><${Th} className="text-right">Spend</${Th}><${Th}>Coverage</${Th}>
        </${Tr}></${THead}>
        <${TBody}>
          ${rows.map((r) => html`<${J.Fragment} key=${r.sourceKey}>
            <${Tr}>
              <${Td} className="w-8">
                <button type="button" aria-expanded=${open === r.sourceKey} aria-label="Show last 10 runs" onClick=${() => setOpen(open === r.sourceKey ? null : r.sourceKey)} className="rounded-sm p-1 hover:bg-accent">
                  <${Icon} name=${open === r.sourceKey ? 'ChevronDown' : 'ChevronRight'} />
                </button>
              </${Td}>
              <${Td} className="font-medium">${r.label}</${Td}>
              <${Td} className="text-muted-foreground">${r.lane === 'media' ? 'Media' : 'Social'}</${Td}>
              <${Td}><${StatusBadge} row=${r} /></${Td}>
              <${Td} className="tabular-nums">${r.lastRunAt ? ist(r.lastRunAt) : 'No data yet'}</${Td}>
              <${Td} className="text-right tabular-nums">${formatCount(r.itemsTotal)}</${Td}>
              <${Td} className="text-right tabular-nums">${formatCount(r.items24h)}</${Td}>
              <${Td} className="text-right tabular-nums">${r.spendUsd ? formatUsd(r.spendUsd) : '-'}</${Td}>
              <${Td}><${Badge} variant="outline" className=${cn('font-normal', r.coverage === 'sampled' && 'border-amber-500/50 text-amber-800 dark:text-amber-300')}>${COVERAGE[r.coverage]}</${Badge}></${Td}>
            </${Tr}>
            ${open === r.sourceKey ? html`<tr><td colSpan="9" className="p-2">${r.lastError ? html`<p className="mb-2 text-sm text-rose-700 dark:text-rose-300">Note: ${r.lastError}</p>` : null}<${Runs} sourceKey=${r.sourceKey} /></td></tr>` : null}
          </${J.Fragment}>`)}
        </${TBody}>
      </${Table}>
    </div>`
  }

  Object.assign(J, { SourcesPage })
})()
