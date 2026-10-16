'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Suspense } from 'react'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { Badge } from '@/components/ui/badge'
import { getBrief, queryKeys } from '@/lib/api'
import { FreshnessPill } from './freshness-pill'
import { useFilters } from './use-filters'

/** Reads the brief query (same key as the brief page, so one request serves both). */
function HeaderFreshness() {
  const { filters } = useFilters()
  const { data } = useQuery({
    queryKey: queryKeys.brief(filters),
    queryFn: () => getBrief(filters),
  })
  return <FreshnessPill freshness={data?.freshness} />
}

const NAV = [
  { href: '/sources', label: 'Sources' },
  { href: '/settings', label: 'Settings' },
  { href: '/accuracy', label: 'Accuracy' },
] as const

export function Header() {
  return (
    <header className="border-b">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
        <div className="flex items-center gap-2">
          <Link href="/" className="text-base font-semibold">
            Jio IPO sentiment
          </Link>
          <Badge variant="secondary">Private</Badge>
        </div>
        <Suspense fallback={<FreshnessPill freshness={undefined} />}>
          <HeaderFreshness />
        </Suspense>
        <nav aria-label="Main" className="ml-auto flex items-center gap-1 text-sm">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {n.label}
            </Link>
          ))}
          <SignOutButton />
        </nav>
      </div>
    </header>
  )
}
