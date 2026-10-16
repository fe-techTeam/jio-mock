import Link from 'next/link'

export function BriefFooter() {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-xs text-muted-foreground">
      <p>Instagram and LinkedIn are sampled, not representative</p>
      {/* The gold-set accuracy figure joins this link with 05-03. */}
      <Link href="/accuracy" className="underline-offset-4 hover:underline">
        Accuracy
      </Link>
    </footer>
  )
}
