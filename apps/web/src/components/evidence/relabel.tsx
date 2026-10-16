'use client'

import {
  ENTITY_KEYS,
  SENTIMENTS,
  type EntityKey,
  type EvidenceItem,
  type Sentiment,
} from '@jio/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LabelResponse } from '@/app/api/labels/_lib/contract'
import { Button } from '@/components/ui/button'
import { useFilters } from '@/components/shell/use-filters'
import { ApiError, getBrief, queryKeys } from '@/lib/api'

export type RelabelCurrent = { sentiment: Sentiment; topicSlug: string; entities: EntityKey[] }
export type RelabelTopic = { slug: string; name: string }

const UNDO_MS = 10_000
const ENTITY_LABEL: Record<EntityKey, string> = {
  mukesh: 'Mukesh',
  akash: 'Akash',
  isha: 'Isha',
  jio: 'Jio',
}
const SENTIMENT_LABEL: Record<Sentiment, string> = {
  negative: 'Negative',
  neutral: 'Neutral',
  positive: 'Positive',
}

async function sendJson<T>(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let message = `http_${res.status}`
    try {
      message = ((await res.json()) as { error?: string }).error ?? message
    } catch {
      // keep the status text
    }
    throw new ApiError(res.status, message)
  }
  return (await res.json()) as T
}

/**
 * One-click relabel for an evidence card. A change applies at once, is saved as a 'correction'
 * and can be undone for 10 seconds; a failed save reverts. Topics load lazily (when the select is
 * first used) from the brief query, so rendering a card costs no request.
 */
export function RelabelControls({
  item,
  topics: topicsProp,
}: {
  item: EvidenceItem
  topics?: RelabelTopic[]
}) {
  const qc = useQueryClient()
  const { filters } = useFilters()
  const entitiesKey = item.entities.join(',')
  const [current, setCurrent] = useState<RelabelCurrent>({
    sentiment: item.sentiment,
    topicSlug: item.topicSlug,
    entities: item.entities,
  })
  const [error, setError] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ id: string; previous: RelabelCurrent } | null>(null)
  const [wantTopics, setWantTopics] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The server copy wins whenever the card's data changes (after the invalidation refetch).
  useEffect(() => {
    setCurrent({
      sentiment: item.sentiment,
      topicSlug: item.topicSlug,
      entities: entitiesKey ? (entitiesKey.split(',') as EntityKey[]) : [],
    })
  }, [item.sentiment, item.topicSlug, entitiesKey])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const brief = useQuery({
    queryKey: queryKeys.brief(filters),
    queryFn: () => getBrief(filters),
    enabled: wantTopics && !topicsProp,
  })
  const known: RelabelTopic[] =
    topicsProp ?? brief.data?.topics.map((t) => ({ slug: t.slug, name: t.name })) ?? []
  const options = known.some((t) => t.slug === current.topicSlug)
    ? known
    : [{ slug: current.topicSlug, name: current.topicSlug }, ...known]

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['evidence'] })
    void qc.invalidateQueries({ queryKey: ['brief'] })
  }, [qc])

  const save = useMutation({
    mutationFn: (next: RelabelCurrent) =>
      sendJson<LabelResponse>('POST', '/api/labels', {
        postId: item.postId,
        origin: 'correction',
        sentiment: next.sentiment,
        topicSlug: next.topicSlug,
        entities: next.entities,
      }),
    onMutate: (next) => {
      const previous = current
      setError(null)
      setUndo(null)
      if (timer.current) clearTimeout(timer.current)
      setCurrent(next)
      return { previous }
    },
    onError: (_err, _next, ctx) => {
      if (ctx) setCurrent(ctx.previous)
      setError('Could not save label')
    },
    onSuccess: (res, _next, ctx) => {
      setUndo({ id: res.classificationId, previous: ctx.previous })
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setUndo(null), UNDO_MS)
      refresh()
    },
  })

  const undoMutation = useMutation({
    mutationFn: (id: string) => sendJson<{ ok: true }>('DELETE', `/api/labels/${id}`),
    onSuccess: () => refresh(),
  })

  function onUndo() {
    if (!undo) return
    const { id, previous } = undo
    setUndo(null)
    if (timer.current) clearTimeout(timer.current)
    setCurrent(previous)
    undoMutation.mutate(id, {
      onError: () => {
        setError('Could not undo label')
        refresh()
      },
    })
  }

  const busy = save.isPending
  const change = (patch: Partial<RelabelCurrent>) => save.mutate({ ...current, ...patch })
  const toggleEntity = (e: EntityKey) =>
    change({
      entities: current.entities.includes(e)
        ? current.entities.filter((x) => x !== e)
        : [...current.entities, e],
    })

  return (
    <div className="flex flex-col gap-2 border-t pt-2 text-xs" data-testid="relabel">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Sentiment">
        {SENTIMENTS.slice()
          .sort((a, b) => SENTIMENT_ORDER.indexOf(a) - SENTIMENT_ORDER.indexOf(b))
          .map((s) => (
            <Button
              key={s}
              type="button"
              size="xs"
              variant={current.sentiment === s ? 'default' : 'outline'}
              aria-pressed={current.sentiment === s}
              disabled={busy}
              onClick={() => current.sentiment !== s && change({ sentiment: s })}
            >
              {SENTIMENT_LABEL[s]}
            </Button>
          ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`relabel-topic-${item.postId}`}>
          Topic
        </label>
        <select
          id={`relabel-topic-${item.postId}`}
          className="h-6 max-w-full rounded-md border bg-background px-1 text-xs"
          value={current.topicSlug}
          disabled={busy}
          onFocus={() => setWantTopics(true)}
          onMouseDown={() => setWantTopics(true)}
          onChange={(e) => change({ topicSlug: e.target.value })}
        >
          {options.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.name}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Entities">
          {ENTITY_KEYS.map((e) => (
            <Button
              key={e}
              type="button"
              size="xs"
              variant={current.entities.includes(e) ? 'secondary' : 'outline'}
              aria-pressed={current.entities.includes(e)}
              disabled={busy}
              onClick={() => toggleEntity(e)}
            >
              {ENTITY_LABEL[e]}
            </Button>
          ))}
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      {undo ? (
        <div role="status" className="flex items-center gap-2 rounded-md bg-muted px-2 py-1">
          <span>Label saved.</span>
          <Button type="button" size="xs" variant="link" onClick={onUndo}>
            Undo
          </Button>
        </div>
      ) : null}
    </div>
  )
}

const SENTIMENT_ORDER: readonly Sentiment[] = ['negative', 'neutral', 'positive']
