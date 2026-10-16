import { SignOutButton } from '@/components/auth/sign-out-button'
import { requireSession } from '@/lib/session'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Every (app) layout must call requireSession(): middleware only checks the cookie exists.
  await requireSession()
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="text-base font-semibold">Jio IPO sentiment</h1>
        <SignOutButton />
      </header>
      <main className="px-4 py-6">{children}</main>
    </div>
  )
}
