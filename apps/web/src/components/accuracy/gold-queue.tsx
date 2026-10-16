'use client'

import { ENTITY_KEYS, type EntityKey, type Sentiment } from '@jio/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { AccuracyResponse } from '@/app/api/accuracy/_lib/compute'
import type { LabelResponse, QueueResponse } from '@/app/api/labels/_lib/contract'
import { formatIst, safeExternalUrl } from '@/components/shell/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, fetchJson } from '@/lib/api'

const MAX_SKIP = 200
const ORDER: readonly Sentiment[] = ['negative', 'neutral', 'positive']
const NAMES: Record<Sentiment, string> = {
  negative: 'Negative',
  neutral: 'Neutral',
  positive: 'Positive',
}
const ENTITY_NAMES: Record<EntityKey, string> = {
  mukesh: 'Mukesh',
  akash: 'Akash',
  isha: 'Isha',
  jio: 'Jio',
}
const LANG_NAMES = { en: 'EN', hinglish: 'Hinglish', hi: 'Hindi', gu: 'Gujarati' } as const

export function GoldQueue({
  accuracy,
  onRescore,
  rescoring = false,
}: {
  accuracy?: AccuracyResponse
  onRescore: () => void
  rescoring?: boolean
}) {
  const qc = useQueryClient()
  const [skip, setSkip] = useState<string[]>([])
  const [sentiment, setSentiment] = useState<Sentiment | null>(null)
  const [topic, setTopic] = useState('')
  const [entities, setEntities] = useState<EntityKey[]>([])
  const [sarcastic, setSarcastic] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const queue = useQuery({
    queryKey: ['gold-queue', skip.join(',')],
    queryFn: () => fetchJson<QueueResponse>('/api/labels/queue', { exclude: skip.join(',') }),
    // Never swap the post under the operator: no polling, no focus refetch.
    refetchInterval: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: 0,
    placeholderData: undefined,
  })
  const item = queue.data?.item ?? null
  const postId = item?.postId

  // A new post starts with a blank form.
  useEffect(() => {
    setSentiment(null)
    setTopic('')
    setEntities([])
    setSarcastic(false)
  }, [postId])

  const save = useMutation({
    mutationFn: () =>
      fetch('/api/labels', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          postId,
          origin: 'gold',
          sentiment,
          topicSlug: topic,
          entities,
          sarcastic,
        }),
      }).then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new ApiError(res.status, body.error ?? `http_${res.status}`)
        }
        return (await res.json()) as LabelResponse
      }),
    onSuccess: () => {
      setMessage(null)
      void qc.invalidateQueries({ queryKey: ['gold-queue'] })
      void qc.invalidateQueries({ queryKey: ['accuracy'] })
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        setMessage('Gold set complete')
        void qc.invalidateQueries({ queryKey: ['gold-queue'] })
        void qc.invalidateQueries({ queryKey: ['accuracy'] })
      } else {
        setMessage('Could not save label')
      }
    },
  })

  const canSave = Boolean(item && sentiment && topic) && !save.isPending

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const idx = ['1', '2', '3'].indexOf(e.key)
      if (idx !== -1 && postId) setSentiment(ORDER[idx]!)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [postId])

  if (queue.isPending) {
    return <Skeleton className="h-64" aria-busy="true" aria-label="Loading gold queue" />
  }
  if (queue.isError) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-4">
          <p role="alert">Could not load the labelling queue.</p>
          <Button variant="outline" size="sm" onClick={() => void queue.refetch()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  const { progress, topics } = queue.data
  const complete = progress.labelled >= progress.target
  const progressLine = (
    <p className="text-sm text-muted-foreground">
      <span className="font-medium text-foreground tabular-nums">
        {progress.labelled} / {progress.target}
      </span>{' '}
      labelled (
      {Object.entries(LANG_NAMES)
        .map(([k, name]) => `${name} ${progress.byLang[k as keyof typeof LANG_NAMES]}`)
        .join(', ')}
      )
    </p>
  )

  if (!item) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3">
          {progressLine}
          {complete ? (
            <>
              <p className="font-medium">Gold set complete</p>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" onClick={onRescore} disabled={rescoring}>
                  Re-score
                </Button>
                {accuracy && accuracy.unscored > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {accuracy.unscored} of {accuracy.target} not yet re-classified with prompt{' '}
                    {accuracy.promptVersion}
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <p className="font-medium">No live posts to label yet</p>
          )}
          {message ? <p role="alert">{message}</p> : null}
        </CardContent>
      </Card>
    )
  }

  const href = safeExternalUrl(item.url)
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        {progressLine}
        <article className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{item.sourceKey}</span>
            <time dateTime={item.publishedAt}>{formatIst(item.publishedAt, 'datetime')} IST</time>
            <span>{item.lang}</span>
          </div>
          <p className="break-words whitespace-pre-wrap">{item.text}</p>
          {item.lang !== 'en' && item.glossEn ? (
            <p className="text-xs text-muted-foreground">EN: {item.glossEn}</p>
          ) : null}
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-xs font-medium underline-offset-4 hover:underline"
            >
              Open original
            </a>
          ) : null}
        </article>

        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Sentiment">
          {ORDER.map((s, i) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant={sentiment === s ? 'default' : 'outline'}
              aria-pressed={sentiment === s}
              onClick={() => setSentiment(s)}
            >
              {NAMES[s]} <kbd className="text-xs opacity-60">{i + 1}</kbd>
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="gold-topic">
            Topic
          </label>
          <select
            id="gold-topic"
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          >
            <option value="">Choose a topic</option>
            {topics.map((t) => (
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
                size="sm"
                variant={entities.includes(e) ? 'secondary' : 'outline'}
                aria-pressed={entities.includes(e)}
                onClick={() =>
                  setEntities((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]))
                }
              >
                {ENTITY_NAMES[e]}
              </Button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sarcastic}
              onChange={(e) => setSarcastic(e.target.checked)}
            />
            Sarcastic
          </label>
        </div>
        {message ? (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="button" disabled={!canSave} onClick={() => save.mutate()}>
            Save and next
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setSkip((cur) => [...cur, item.postId].slice(-MAX_SKIP))}
          >
            Skip
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
