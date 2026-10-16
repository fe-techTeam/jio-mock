// App shell: the (app) layout (header, main, evidence drawer, toaster) and routes.
// The mock has no sign-in: it opens straight on the dashboard.
;(function () {
  const { html, useEffect, useRoute, Toaster } = J

  // --- (app)/layout.tsx ----------------------------------------------------------------------
  function AppLayout({ children }) {
    return html`<${J.Fragment}>
      <div className="min-h-screen">
        <${J.Header} />
        <main className="mx-auto max-w-6xl px-4 py-6">${children}</main>
      </div>
      <${J.EvidenceDrawer} />
    </${J.Fragment}>`
  }

  function App() {
    const route = useRoute()
    // Old sign-in links land on the dashboard.
    const path = route.path === '/login' ? '/' : route.path
    useEffect(() => {
      if (route.path === '/login') history.replaceState(null, '', '#/')
    }, [route.path])
    let page
    const topic = path.match(/^\/topics\/([^/]+)$/)
    if (path === '/') page = html`<${J.BriefPage} />`
    else if (topic) page = html`<${J.TopicPage} key=${topic[1]} slug=${decodeURIComponent(topic[1])} />`
    else if (path === '/sources') page = html`<${J.SourcesPage} />`
    else if (path === '/settings') page = html`<${J.SettingsPage} />`
    else if (path === '/accuracy') page = html`<${J.AccuracyPage} />`
    else page = html`<div className="py-12 text-center"><h1 className="text-xl font-semibold">Page not found</h1><${J.Link} href="/" className="text-sm underline underline-offset-4">Back to the overview</${J.Link}></div>`
    return html`<${J.Fragment}><${AppLayout}>${page}</${AppLayout}><${Toaster} /></${J.Fragment}>`
  }

  // Track page views in the audit log, as the real (app) layout does.
  let lastPath = null
  window.addEventListener('hashchange', () => {
    const p = location.hash.replace(/^#/, '').split('?')[0]
    if (p !== lastPath) J.api.logEvent('view', p === '/' ? 'Executive brief' : p)
    lastPath = p
  })

  ReactDOM.createRoot(document.getElementById('root')).render(html`<${App} />`)
})()
