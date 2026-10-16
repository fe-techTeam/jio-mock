'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { EmergingRow, PromoteBody, SeedTopicRow } from '@/app/api/config/_lib/contract'
import { formatIst } from '@/components/shell/format'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  configKey,
  getConfigTopics,
  patchTopic,
  promoteTopic,
  saveErrorMessage,
  topicsKey,
} from './api'
import { TabError, TabSkeleton } from './tab-states'

export function TopicsTab() {
  const client = useQueryClient()
  const q = useQuery({ queryKey: topicsKey, queryFn: getConfigTopics })
  if (q.isPending) return <TabSkeleton label="Loading topics" />
  if (q.isError && !q.data) return <TabError onRetry={() => q.refetch()} />
  const data = q.data!
  const refresh = () => {
    void client.invalidateQueries({ queryKey: topicsKey })
    void client.invalidateQueries({ queryKey: ['brief'] })
  }
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Seeded topics</CardTitle>
          <CardDescription>
            Edits apply to the next classification run. The last save wins.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {data.seed.map((t) => (
            <SeedRow key={t.slug} topic={t} onSaved={refresh} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Emerging candidates</CardTitle>
          <CardDescription>
            Clusters of relevant posts outside the seeded topics. Promote one to make it a topic.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {data.emerging.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing new outside the 10 topics</p>
          ) : (
            data.emerging.map((e) => (
              <EmergingCard key={e.slug} row={e} seeds={data.seed} onDone={refresh} />
            ))
          )}
          <p className="text-sm text-muted-foreground">
            {`Unclassified (24h): ${data.unclassified.count24h}`}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

const textareaClass =
  'min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

function SeedRow({ topic, onSaved }: { topic: SeedTopicRow; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(topic.name)
  const [description, setDescription] = useState(topic.description)
  const [phrases, setPhrases] = useState(topic.examplePhrases.join('\n'))
  const save = useMutation({
    mutationFn: () =>
      patchTopic({
        slug: topic.slug,
        name,
        description,
        examplePhrases: phrases.split('\n'),
      }),
    onSuccess: () => {
      setEditing(false)
      onSaved()
    },
  })

  if (!editing) {
    return (
      <div className="flex flex-wrap items-start gap-3 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{topic.name}</p>
          <p className="text-sm text-muted-foreground">{topic.description || 'No description'}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {topic.examplePhrases.length} example phrases, {topic.items24h} items in 24h
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
          {`Edit ${topic.name}`}
        </Button>
      </div>
    )
  }
  return (
    <form
      className="flex flex-col gap-2 py-3"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <label className="text-sm font-medium" htmlFor={`${topic.slug}-name`}>
        Name
      </label>
      <Input id={`${topic.slug}-name`} value={name} onChange={(e) => setName(e.target.value)} />
      <label className="text-sm font-medium" htmlFor={`${topic.slug}-desc`}>
        Description
      </label>
      <textarea
        id={`${topic.slug}-desc`}
        className={textareaClass}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <label className="text-sm font-medium" htmlFor={`${topic.slug}-phrases`}>
        Example phrases (one per line)
      </label>
      <textarea
        id={`${topic.slug}-phrases`}
        className={textareaClass}
        value={phrases}
        onChange={(e) => setPhrases(e.target.value)}
      />
      {save.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{saveErrorMessage(save.error)}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          Save topic
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function EmergingCard({
  row,
  seeds,
  onDone,
}: {
  row: EmergingRow
  seeds: SeedTopicRow[]
  onDone: () => void
}) {
  const client = useQueryClient()
  const [rename, setRename] = useState('')
  const [into, setInto] = useState('')
  const [confirmDismiss, setConfirmDismiss] = useState(false)
  const act = useMutation({
    mutationFn: (b: PromoteBody) => promoteTopic(row.slug, b),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: configKey })
      onDone()
    },
  })

  return (
    <div data-testid="emerging-card" className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{row.name}</p>
        <Badge variant="secondary">{row.items24h} in 24h</Badge>
        <span className="text-xs text-muted-foreground">
          {`First seen ${formatIst(row.createdAt, 'datetime')}`}
        </span>
      </div>
      <ul className="flex flex-col gap-2 text-sm">
        {row.samples.map((s, i) => (
          <li key={i}>
            <p>{s.text}</p>
            {s.glossEn && s.lang !== 'en' ? (
              <p className="text-xs text-muted-foreground">{s.glossEn}</p>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <Input
          aria-label={`Rename ${row.name} (optional)`}
          className="w-52"
          placeholder="Rename (optional)"
          value={rename}
          onChange={(e) => setRename(e.target.value)}
        />
        <Button
          type="button"
          size="sm"
          disabled={act.isPending}
          onClick={() =>
            act.mutate(
              rename.trim() ? { action: 'promote', name: rename.trim() } : { action: 'promote' },
            )
          }
        >
          Promote
        </Button>
        <select
          aria-label={`Merge ${row.name} into`}
          className="h-9 rounded-md border bg-transparent px-2 text-sm"
          value={into}
          onChange={(e) => setInto(e.target.value)}
        >
          <option value="">Merge into...</option>
          {seeds.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!into || act.isPending}
          onClick={() => act.mutate({ action: 'merge', intoSlug: into })}
        >
          Merge
        </Button>
        {confirmDismiss ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={act.isPending}
              onClick={() => act.mutate({ action: 'dismiss' })}
            >
              Confirm dismiss
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setConfirmDismiss(false)}
            >
              Keep
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirmDismiss(true)}>
            Dismiss
          </Button>
        )}
      </div>
      {act.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{saveErrorMessage(act.error)}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
