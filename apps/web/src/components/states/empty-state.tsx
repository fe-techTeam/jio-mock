import type { ReactNode } from 'react'

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center text-sm">
      <p className="font-medium text-muted-foreground">{title}</p>
      {description ? <p className="text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  )
}

/** Shown in place of a sentiment split when a slice has fewer items than the split threshold. */
export function NotEnoughData({ n }: { n: number }) {
  return <span className="text-xs text-muted-foreground">Not enough data (n={n})</span>
}
