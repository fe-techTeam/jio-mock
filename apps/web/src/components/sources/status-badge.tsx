import type { SourceMode, SourceStatus } from '@/app/api/sources/_lib/contract'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const STATUS: Record<SourceStatus, { label: string; cls: string }> = {
  ok: {
    label: 'OK',
    cls: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  },
  stale: {
    label: 'Stale',
    cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  },
  circuit_open: {
    label: 'Circuit open',
    cls: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  },
  waiting: { label: 'Waiting for first run', cls: 'bg-muted text-muted-foreground' },
  disabled: { label: 'Disabled', cls: 'bg-muted text-muted-foreground/70' },
}

export function statusLabel(s: SourceStatus): string {
  return STATUS[s].label
}

export function StatusBadge({ status, title }: { status: SourceStatus; title?: string }) {
  const s = STATUS[status]
  return (
    <Badge variant="ghost" className={cn(s.cls)} title={title}>
      {s.label}
    </Badge>
  )
}

/** 'fixture' explains what is missing; the X row shows its own label instead. */
export function modeText(mode: SourceMode, missingCreds: string[]): string {
  if (mode === 'live') return 'live'
  return missingCreds.length ? `Not configured: missing ${missingCreds.join(', ')}` : 'fixture'
}

export function ModeBadge({
  mode,
  missingCreds,
  label,
}: {
  mode: SourceMode
  missingCreds: string[]
  label?: string
}) {
  return (
    <Badge variant={mode === 'live' ? 'secondary' : 'outline'} className="whitespace-normal">
      {label ?? modeText(mode, missingCreds)}
    </Badge>
  )
}
