import { Suspense } from 'react'
import { EvidenceDrawer } from '@/components/evidence/evidence-drawer'
import { Providers } from '@/components/providers'
import { Header } from '@/components/shell/header'
import { requireSession } from '@/lib/session'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Every (app) layout must call requireSession(): middleware only checks the cookie exists.
  // It also redirects to /login without a valid session and logs the view event.
  await requireSession()
  return (
    <Providers>
      <div className="min-h-screen">
        <Header />
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </div>
      {/* One drawer for every (app) page: it opens from the `evidence` URL param. */}
      <Suspense>
        <EvidenceDrawer />
      </Suspense>
    </Providers>
  )
}
