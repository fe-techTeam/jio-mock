'use client'

import { X } from 'lucide-react'
import { useId, useState } from 'react'
import { BARE_AMBIGUOUS, BARE_JIO_MESSAGE } from '@/app/api/config/_lib/validate'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

type Props = {
  /** Visible heading, e.g. "IPO terms". */
  label: string
  /** Accessible name of the input, e.g. "Add IPO term". */
  addLabel: string
  values: string[]
  onChange: (next: string[]) => void
  /** Messages from the shared validator for this list (already filtered by path). */
  errors?: string[]
  /** Warn about a bare ambiguous word while it is still being typed. */
  warnBare?: boolean
  placeholder?: string
  hint?: string
}

export function TermListEditor({
  label,
  addLabel,
  values,
  onChange,
  errors = [],
  warnBare = false,
  placeholder,
  hint,
}: Props) {
  const [text, setText] = useState('')
  const id = useId()
  const pendingBare = warnBare && BARE_AMBIGUOUS.includes(text.trim().toLowerCase())

  function add() {
    const t = text.trim()
    if (!t) return
    onChange([...values, t])
    setText('')
  }

  const messages = [...(pendingBare ? [BARE_JIO_MESSAGE] : []), ...new Set(errors)]

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <span className="text-xs text-muted-foreground">{values.length}</span>
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <ul className="flex max-h-40 flex-wrap gap-1 overflow-y-auto" aria-label={`${label} list`}>
        {values.map((v, i) => (
          <li key={`${v}-${i}`}>
            <Badge variant="secondary" className="gap-1 pr-1">
              <span>{v}</span>
              <button
                type="button"
                aria-label={`Remove ${v}`}
                className="rounded-sm p-0.5 hover:bg-background"
                onClick={() => onChange(values.filter((_, j) => j !== i))}
              >
                <X className="size-3" aria-hidden />
              </button>
            </Badge>
          </li>
        ))}
      </ul>
      <Input
        id={id}
        aria-label={addLabel}
        aria-invalid={messages.length > 0}
        value={text}
        placeholder={placeholder ?? 'Type a term and press Enter'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add()
          }
        }}
      />
      {messages.map((m) => (
        <p key={m} role="alert" className="text-xs text-destructive">
          {m}
        </p>
      ))}
    </div>
  )
}
