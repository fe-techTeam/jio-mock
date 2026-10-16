import Link from 'next/link'
import { Button } from '@/components/ui/button'

// Placeholder. Phase 01-03 replaces this with the (app) route group and must delete this file.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-start justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold">Jio IPO sentiment board</h1>
      <p className="text-muted-foreground">Foundation build. Sign-in arrives in Phase 01.</p>
      <Button asChild>
        <Link href="/api/health">Check health</Link>
      </Button>
    </main>
  )
}
