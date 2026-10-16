// Shared UI layer: router, URL filters, format helpers and shadcn-equivalent
// primitives. Class strings are copied from apps/web/src/components/ui/* so the demo renders
// the same as the real app. Everything hangs off window.J.
;(function () {
  const { createElement, useState, useEffect, useCallback, useMemo, useRef, Fragment } = React
  const html = htm.bind(createElement)
  // cn with a small tailwind-merge stand-in: for conflicting utilities in the same group (and the
  // same variant prefix), the later class wins, as cn() does in the real app.
  const GROUPS = [
    [/^(w|min-w|max-w|h|min-h|size)-/, (m) => m[1]],
    [/^(px|py|pl|pr|pt|pb|p|mx|my|m|gap|gap-x|gap-y)-/, (m) => m[1]],
    [/^rounded(-|$)/, () => 'rounded'],
    [/^text-(xs|sm|base|lg|xl|2xl|3xl)$/, () => 'text-size'],
    [/^flex-(1|auto|none|initial)$/, () => 'flex-grow'],
  ]
  function cn(...xs) {
    const list = xs.flat().filter(Boolean).join(' ').split(/\s+/).filter(Boolean)
    const seen = new Map()
    const out = []
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i]
      const cut = c.lastIndexOf(':') + 1
      const variant = c.slice(0, cut)
      const base = c.slice(cut)
      let key = null
      for (const [re, k] of GROUPS) {
        const m = base.match(re)
        if (m) {
          key = variant + k(m)
          break
        }
      }
      if (key && seen.has(key)) continue
      if (key) seen.set(key, true)
      out.unshift(c)
    }
    return out.join(' ')
  }

  // -------------------------------------------------------------------------------------------
  // Hash router: '#/topics/gmp-grey-market?entity=isha' -> { path, params }

  function readLocation() {
    const raw = location.hash.replace(/^#/, '') || '/'
    const [path, q = ''] = raw.split('?')
    return { path: path || '/', search: q, params: new URLSearchParams(q) }
  }
  const listeners = new Set()
  window.addEventListener('hashchange', () => listeners.forEach((l) => l()))
  function navigate(href, { replace = false } = {}) {
    const target = '#' + href
    if (replace) {
      history.replaceState(null, '', target)
      listeners.forEach((l) => l())
    } else {
      location.hash = href
    }
  }
  function useRoute() {
    const [loc, setLoc] = useState(readLocation)
    useEffect(() => {
      const l = () => setLoc(readLocation())
      listeners.add(l)
      return () => listeners.delete(l)
    }, [])
    return loc
  }
  const hrefWith = (path, params) => {
    const q = params.toString()
    return q ? `${path}?${q}` : path
  }
  function Link({ href, className, children, ...rest }) {
    return html`<a href=${'#' + href} className=${className} ...${rest}>${children}</a>`
  }

  // URL filters (use-filters.ts): entity and lane, unknown values fall back to 'all'.
  const ENTITY_KEYS = ['mukesh', 'akash', 'isha', 'jio']
  // The filter groups people under 'leadership' so no individual is named in the top bar.
  const FILTER_ENTITIES = ['leadership', 'jio']
  const LEADERSHIP = ['mukesh', 'akash', 'isha']
  const LANES = ['social', 'media']
  function parseFilters(params) {
    const e = params.get('entity')
    const l = params.get('lane')
    return {
      entity: e && FILTER_ENTITIES.includes(e) ? e : 'all',
      lane: l && LANES.includes(l) ? l : 'all',
    }
  }
  function useFilters() {
    const route = useRoute()
    const filters = useMemo(() => parseFilters(route.params), [route.search])
    const setFilter = useCallback(
      (key, value) => {
        const next = new URLSearchParams(route.search)
        if (value === 'all') next.delete(key)
        else next.set(key, value)
        navigate(hrefWith(route.path, next), { replace: true })
      },
      [route.search, route.path],
    )
    return { filters, setFilter }
  }
  /** '/?entity=isha' style query carrying only the non-'all' filters. */
  function filterQuery(filters) {
    const p = new URLSearchParams()
    if (filters.entity !== 'all') p.set('entity', filters.entity)
    if (filters.lane !== 'all') p.set('lane', filters.lane)
    const q = p.toString()
    return q ? `?${q}` : ''
  }

  // -------------------------------------------------------------------------------------------
  // Polling data hook (TanStack Query stand-in): runs `fn` now, every 30 s and on store changes.

  function useQuery(fn, deps, { interval = 30_000, delay = 220 } = {}) {
    const [state, setState] = useState({ data: undefined, isError: false })
    const fnRef = useRef(fn)
    fnRef.current = fn
    const run = useCallback(() => {
      try {
        setState({ data: fnRef.current(), isError: false })
      } catch (err) {
        console.error(err)
        setState((s) => ({ data: s.data, isError: true }))
      }
    }, [])
    useEffect(() => {
      const first = setTimeout(run, delay) // brief skeleton, like a real network round trip
      const id = interval ? setInterval(run, interval) : null
      const unsub = J.store ? J.store.subscribe(run) : () => {}
      return () => {
        clearTimeout(first)
        if (id) clearInterval(id)
        unsub()
      }
    }, deps)
    return { ...state, refetch: run }
  }

  // -------------------------------------------------------------------------------------------
  // Motion: an eased 0 -> 1 progress value and a number that counts towards its target.

  const reducedMotion = () => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      return false
    }
  }
  const easeOut = (x) => 1 - Math.pow(1 - x, 3)
  /** Eased progress from 0 to 1 over `duration` ms, restarted whenever `replayKey` changes. */
  function useProgress(duration = 900, delay = 0, replayKey) {
    const [p, setP] = useState(reducedMotion() ? 1 : 0)
    useEffect(() => {
      if (reducedMotion()) return setP(1)
      setP(0)
      let raf
      const t0 = performance.now() + delay
      const tick = (now) => {
        const x = Math.min(1, Math.max(0, (now - t0) / duration))
        setP(easeOut(x))
        if (x < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(raf)
    }, [replayKey])
    return p
  }
  /** Counts from the previous value (0 at first) to `value`. */
  function CountUp({ value, format = (n) => formatCount(Math.round(n)), duration = 900, delay = 0 }) {
    const from = useRef(0)
    const [shown, setShown] = useState(reducedMotion() ? value : 0)
    useEffect(() => {
      if (reducedMotion()) {
        from.current = value
        return setShown(value)
      }
      const start = from.current
      let raf
      const t0 = performance.now() + delay
      const tick = (now) => {
        const x = Math.min(1, Math.max(0, (now - t0) / duration))
        setShown(start + (value - start) * easeOut(x))
        if (x < 1) raf = requestAnimationFrame(tick)
        else from.current = value
      }
      raf = requestAnimationFrame(tick)
      return () => {
        cancelAnimationFrame(raf)
        from.current = value
      }
    }, [value])
    return format(shown)
  }
  /** Inline style for a staggered entry animation. */
  const delay = (ms) => ({ '--d': `${Math.round(ms)}ms` })

  // -------------------------------------------------------------------------------------------
  // Format helpers (shell/format.ts). Every on-screen time is IST.

  const IST = 'Asia/Kolkata'
  const timeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const dayFmt = new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short' })
  const part = (parts, type) => parts.find((p) => p.type === type)?.value ?? ''
  const hhmm = (d) => {
    const p = timeFmt.formatToParts(d)
    return `${part(p, 'hour').padStart(2, '0')}:${part(p, 'minute').padStart(2, '0')}`
  }
  const dayMonth = (d) => {
    const p = dayFmt.formatToParts(d)
    return `${part(p, 'day')} ${part(p, 'month')}`
  }
  function formatIst(iso, mode = 'time') {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '-'
    return mode === 'time' ? `${hhmm(d)} IST` : `${hhmm(d)} ${dayMonth(d)}`
  }
  function formatIstRange(fromIso, toIso) {
    const from = new Date(fromIso)
    const to = new Date(toIso)
    const fd = dayMonth(from)
    const td = dayMonth(to)
    if (fd === td) return `${hhmm(from)}-${hhmm(to)} ${td} IST`
    return `${hhmm(from)} ${fd}-${hhmm(to)} ${td} IST`
  }
  function pctSplit(c) {
    const keys = ['pos', 'neu', 'neg']
    const total = c.pos + c.neu + c.neg
    if (total <= 0) return { pos: 0, neu: 0, neg: 0 }
    const raw = keys.map((k) => (c[k] / total) * 100)
    const floors = raw.map(Math.floor)
    let left = 100 - floors.reduce((a, b) => a + b, 0)
    const order = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem || a.i - b.i)
    for (const { i } of order) {
      if (left <= 0) break
      floors[i] += 1
      left -= 1
    }
    return { pos: floors[0], neu: floors[1], neg: floors[2] }
  }
  const formatAge = (min) => (min < 120 ? `${Math.max(0, Math.round(min))} min` : `${Math.floor(min / 60)} h`)
  const countFmt = new Intl.NumberFormat('en-IN')
  const formatCount = (n) => countFmt.format(n)
  const formatDeltaPct = (pct) => {
    const r = Math.round(pct)
    return r > 0 ? `+${r}%` : `${r}%`
  }
  function safeExternalUrl(url) {
    if (!url) return null
    try {
      const u = new URL(url)
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
    } catch {
      return null
    }
  }
  const formatUsd = (n) => `$${n.toFixed(2)}`

  // -------------------------------------------------------------------------------------------
  // Icons (lucide paths)

  const ICONS = {
    ArrowUpRight: ['M7 7h10v10', 'M7 17 17 7'],
    ArrowDownRight: ['m7 7 10 10', 'M17 7v10H7'],
    ArrowRight: ['M5 12h14', 'm12 5 7 7-7 7'],
    ArrowLeft: ['m12 19-7-7 7-7', 'M19 12H5'],
    ExternalLink: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
    LogOut: ['m16 17 5-5-5-5', 'M21 12H9', 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'],
    AlertTriangle: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
    AlertCircle: ['M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20', 'M12 8v4', 'M12 16h.01'],
    Info: ['M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20', 'M12 16v-4', 'M12 8h.01'],
    RefreshCw: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'],
    Loader2: ['M21 12a9 9 0 1 1-6.219-8.56'],
    X: ['M18 6 6 18', 'm6 6 12 12'],
    ChevronDown: ['m6 9 6 6 6-6'],
    ChevronRight: ['m9 18 6-6-6-6'],
    Lock: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
    Check: ['M20 6 9 17l-5-5'],
    Plus: ['M5 12h14', 'M12 5v14'],
    Undo2: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11'],
    Activity: ['M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2'],
    Lightbulb: ['M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5', 'M9 18h6', 'M10 22h4'],
    TrendingUp: ['M22 7 13.5 15.5 8.5 10.5 2 17', 'M16 7h6v6'],
    TrendingDown: ['M22 17 13.5 8.5 8.5 13.5 2 7', 'M16 17h6v-6'],
    Minus: ['M5 12h14'],
    CheckCircle: ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'm9 11 3 3L22 4'],
    Eye: ['M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0', 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6'],
    Users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 3a4 4 0 1 0 0 8a4 4 0 1 0 0-8', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
    MessageCircle: ['M7.9 20A9 9 0 1 0 4 16.1L2 22Z'],
    IndianRupee: ['M6 3h12', 'M6 8h12', 'm6 13 8.5 8', 'M6 13h3', 'M9 13c6.667 0 6.667-10 0-10'],
    Megaphone: ['m3 11 18-5v12L3 14v-3z', 'M11.6 16.8a3 3 0 1 1-5.8-1.6'],
    Calendar: ['M8 2v4', 'M16 2v4', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M3 10h18'],
    Sparkles: ['M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z'],
    FlaskConical: ['M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2', 'M6.453 15h11.094', 'M8.5 2h7'],
  }
  function Icon({ name, className }) {
    const paths = ICONS[name] ?? []
    return html`<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className=${cn('lucide size-4', className)}
    >
      ${paths.map((d, i) => html`<path key=${i} d=${d} />`)}
    </svg>`
  }

  // -------------------------------------------------------------------------------------------
  // Primitives (class strings from components/ui)

  const BUTTON_BASE =
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
  const BUTTON_VARIANT = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/90',
    destructive: 'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20',
    outline: 'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    ghost: 'hover:bg-accent hover:text-accent-foreground',
    link: 'text-primary underline-offset-4 hover:underline',
  }
  const BUTTON_SIZE = {
    default: 'h-9 px-4 py-2 has-[>svg]:px-3',
    xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
    sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
    lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
    icon: 'size-9',
    'icon-sm': 'size-8',
  }
  function Button({ variant = 'default', size = 'default', className, children, type = 'button', ...rest }) {
    return html`<button type=${type} className=${cn(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)} ...${rest}>${children}</button>`
  }

  const BADGE_BASE =
    'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] [&>svg]:pointer-events-none [&>svg]:size-3'
  const BADGE_VARIANT = {
    default: 'bg-primary text-primary-foreground',
    secondary: 'bg-secondary text-secondary-foreground',
    destructive: 'bg-destructive text-white',
    outline: 'border-border text-foreground',
  }
  function Badge({ variant = 'default', className, children, ...rest }) {
    return html`<span className=${cn(BADGE_BASE, BADGE_VARIANT[variant], className)} ...${rest}>${children}</span>`
  }

  const TOGGLE_BASE =
    "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-[color,box-shadow] outline-none hover:bg-muted hover:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0"
  const TOGGLE_OUTLINE = 'border border-input bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground'
  /** shadcn ToggleGroup type="single" variant="outline" size="sm". */
  function ToggleGroup({ value, onValueChange, options, labelledBy, itemClassName = 'px-3 flex-none' }) {
    return html`<div role="group" aria-labelledby=${labelledBy} data-variant="outline" data-size="sm" className="group/toggle-group flex w-fit items-center rounded-md data-[variant=outline]:shadow-xs">
      ${options.map(
        (o) => html`<button
          key=${o.value}
          type="button"
          aria-pressed=${value === o.value}
          data-state=${value === o.value ? 'on' : 'off'}
          data-variant="outline"
          onClick=${() => onValueChange(o.value)}
          className=${cn(TOGGLE_BASE, TOGGLE_OUTLINE, 'h-8 min-w-8 px-1.5', 'min-w-0 flex-1 shrink-0 rounded-none shadow-none first:rounded-l-md last:rounded-r-md focus:z-10 focus-visible:z-10 data-[variant=outline]:border-l-0 data-[variant=outline]:first:border-l', itemClassName)}
        >
          ${o.label}
        </button>`,
      )}
    </div>`
  }
  /** A single shadcn Toggle (outline, sm), used for entity toggles in relabel controls. */
  function Toggle({ pressed, onClick, children, className, ...rest }) {
    return html`<button type="button" aria-pressed=${pressed} data-state=${pressed ? 'on' : 'off'} onClick=${onClick} className=${cn(TOGGLE_BASE, TOGGLE_OUTLINE, 'h-8 min-w-8 px-2 text-xs', className)} ...${rest}>${children}</button>`
  }

  const SELECT_TRIGGER =
    'flex w-fit appearance-none items-center justify-between gap-2 rounded-md border border-input bg-transparent py-2 pr-8 pl-3 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50'
  /** Native select styled as the shadcn SelectTrigger (same box, chevron, focus ring). */
  function Select({ value, onValueChange, options, size = 'default', className, ...rest }) {
    return html`<span className="relative inline-flex w-fit self-start">
      <select
        value=${value}
        onChange=${(e) => onValueChange(e.target.value)}
        className=${cn(SELECT_TRIGGER, size === 'sm' ? 'h-8' : 'h-9', 'py-0', className)}
        ...${rest}
      >
        ${options.map((o) => html`<option key=${o.value} value=${o.value}>${o.label}</option>`)}
      </select>
      <${Icon} name="ChevronDown" className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground opacity-50" />
    </span>`
  }

  const INPUT =
    'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20'
  const Input = ({ className, ...rest }) => html`<input className=${cn(INPUT, className)} ...${rest} />`
  const Label = ({ className, children, ...rest }) =>
    html`<label className=${cn('flex items-center gap-2 text-sm leading-none font-medium select-none', className)} ...${rest}>${children}</label>`

  const Table = ({ className, children }) =>
    html`<div data-slot="table-container" className="relative w-full overflow-x-auto"><table className=${cn('w-full caption-bottom text-sm', className)}>${children}</table></div>`
  const THead = ({ children }) => html`<thead className="[&_tr]:border-b">${children}</thead>`
  const TBody = ({ children }) => html`<tbody className="[&_tr:last-child]:border-0">${children}</tbody>`
  const Tr = ({ className, children, ...rest }) =>
    html`<tr className=${cn('border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted', className)} ...${rest}>${children}</tr>`
  const Th = ({ className, children }) =>
    html`<th className=${cn('h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground', className)}>${children}</th>`
  const Td = ({ className, children, ...rest }) => html`<td className=${cn('p-2 align-middle', className)} ...${rest}>${children}</td>`

  const Card = ({ className, children }) =>
    html`<div className=${cn('flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm', className)}>${children}</div>`
  const CardHeader = ({ className, children }) =>
    html`<div className=${cn('grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6', className)}>${children}</div>`
  const CardTitle = ({ className, children }) => html`<div className=${cn('leading-none font-semibold', className)}>${children}</div>`
  const CardDescription = ({ className, children }) => html`<div className=${cn('text-sm text-muted-foreground', className)}>${children}</div>`
  const CardContent = ({ className, children }) => html`<div className=${cn('px-6', className)}>${children}</div>`

  const Skeleton = ({ className }) => html`<div className=${cn('animate-pulse rounded-md bg-accent', className)} />`

  function Alert({ children, variant = 'default' }) {
    return html`<div role="alert" className=${cn(
      'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current',
      variant === 'destructive' ? 'bg-card text-destructive' : 'bg-card text-card-foreground',
    )}>${children}</div>`
  }
  const AlertDescription = ({ children }) =>
    html`<div className="col-start-2 grid justify-items-start gap-1 text-sm text-muted-foreground [&_p]:leading-relaxed">${children}</div>`

  /** shadcn Sheet (right side): overlay, sliding panel and close button. Esc closes. */
  function Sheet({ open, onClose, className, children }) {
    useEffect(() => {
      if (!open) return
      const onKey = (e) => e.key === 'Escape' && onClose()
      document.addEventListener('keydown', onKey)
      document.body.style.overflow = 'hidden'
      return () => {
        document.removeEventListener('keydown', onKey)
        document.body.style.overflow = ''
      }
    }, [open])
    if (!open) return null
    return ReactDOM.createPortal(
      html`<div>
        <div className="anim-fade fixed inset-0 z-50 bg-black/50" onClick=${onClose} />
        <div role="dialog" aria-modal="true" className=${cn('anim-sheet fixed inset-y-0 right-0 z-50 flex h-full w-3/4 flex-col gap-4 border-l bg-background shadow-lg sm:max-w-sm', className)}>
          ${children}
          <button type="button" onClick=${onClose} className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden">
            <${Icon} name="X" />
            <span className="sr-only">Close</span>
          </button>
        </div>
      </div>`,
      document.body,
    )
  }

  // Toasts (sonner look, bottom-right)
  let pushToast = () => {}
  function toast(message, opts = {}) {
    pushToast({ id: Math.random().toString(36).slice(2), message, ...opts })
  }
  function Toaster() {
    const [items, setItems] = useState([])
    useEffect(() => {
      pushToast = (t) => {
        setItems((xs) => [...xs, t])
        setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.duration ?? 4000)
      }
    }, [])
    return html`<div className="fixed right-4 bottom-4 z-[60] flex w-[356px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      ${items.map(
        (t) => html`<div key=${t.id} className=${cn('anim-toast flex items-center gap-3 rounded-lg border bg-background p-4 text-sm shadow-lg', t.error && 'text-destructive')}>
          <span className="flex-1">${t.message}</span>
          ${t.action
            ? html`<${Button} size="xs" onClick=${() => {
                t.action.onClick()
                setItems((xs) => xs.filter((x) => x.id !== t.id))
              }}>${t.action.label}</${Button}>`
            : null}
        </div>`,
      )}
    </div>`
  }

  /** Shown above data that is still on screen after a failed poll (shell/stale-banner.tsx). */
  function StaleBanner({ asOf, onRetry }) {
    return html`<div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/50 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <${Icon} name="AlertTriangle" className="size-4 shrink-0" />
      <span className="flex-1">Could not refresh, showing data as of ${formatIst(asOf, 'time')}</span>
      <${Button} variant="outline" size="xs" onClick=${onRetry}><${Icon} name="RefreshCw" />Retry</${Button}>
    </div>`
  }

  function BackLink({ href, children = 'Back to brief' }) {
    return html`<${Link} href=${href} className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
      <${Icon} name="ArrowLeft" className="size-3.5" />${children}
    </${Link}>`
  }

  function ErrorPanel({ text, onRetry }) {
    return html`<div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4 text-sm">
      <span>${text}</span>
      <${Button} variant="outline" size="sm" onClick=${onRetry}><${Icon} name="RefreshCw" />Retry</${Button}>
    </div>`
  }

  window.J = {
    html, cn, Fragment, useState, useEffect, useCallback, useMemo, useRef,
    useRoute, navigate, hrefWith, Link, parseFilters, useFilters, filterQuery, useQuery,
    formatIst, formatIstRange, pctSplit, formatAge, formatCount, formatDeltaPct, safeExternalUrl, formatUsd,
    Icon, Button, Badge, ToggleGroup, Toggle, Select, Input, Label,
    Table, THead, TBody, Tr, Th, Td, Card, CardHeader, CardTitle, CardDescription, CardContent,
    Skeleton, Alert, AlertDescription, Sheet, toast, Toaster, StaleBanner, BackLink, ErrorPanel,
    ENTITY_KEYS, FILTER_ENTITIES, LEADERSHIP, LANES, useProgress, CountUp, delay,
  }
})()
