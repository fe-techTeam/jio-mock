'use client'

import type { TimelineTopic } from '@jio/core'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { formatIst } from '@/components/shell/format'
import type { Filters } from '@/lib/api'
import { backHref, dormantText } from './chart-data'

export function TopicHeader({ topic, filters }: { topic: TimelineTopic; filters: Filters }) {
  return (
    <header className="flex flex-col gap-2">
      <Link
        href={backHref(filters)}
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to brief
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{topic.name}</h1>
      {topic.summary2line ? (
        <div className="max-w-3xl text-sm">
          <p>{topic.summary2line}</p>
          {topic.summaryAt ? (
            <p className="text-xs text-muted-foreground">
              Summary generated {formatIst(topic.summaryAt, 'time')}
            </p>
          ) : null}
        </div>
      ) : null}
      {topic.items24h === 0 ? (
        <p className="text-sm text-muted-foreground">{dormantText(topic.lastItemAt)}</p>
      ) : null}
    </header>
  )
}
