'use client'

import type { TermsConfig } from '@jio/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { ConfigResponse, TestTermsResponse } from '@/app/api/config/_lib/contract'
import { validateTerms } from '@/app/api/config/_lib/validate'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ApiError } from '@/lib/api'
import { configKey, getSettingsConfig, patchConfig, saveErrorMessage, testTerms } from './api'
import { TabError, TabSkeleton } from './tab-states'
import { TermListEditor } from './term-list-editor'

const ENTITIES = [
  { key: 'mukesh', name: 'Mukesh' },
  { key: 'akash', name: 'Akash' },
  { key: 'isha', name: 'Isha' },
  { key: 'jio', name: 'Jio' },
] as const

export function KeywordsTab() {
  const q = useQuery({ queryKey: configKey, queryFn: getSettingsConfig })
  if (q.isPending) return <TabSkeleton label="Loading keywords" />
  if (q.isError && !q.data) return <TabError onRetry={() => q.refetch()} />
  // Remount on a new config version so the draft restarts from what is saved.
  return <KeywordsEditor key={q.data!.version} config={q.data!} onReload={() => q.refetch()} />
}

function KeywordsEditor({ config, onReload }: { config: ConfigResponse; onReload: () => void }) {
  const client = useQueryClient()
  const [draft, setDraft] = useState<TermsConfig>(() => structuredClone(config.terms))
  const [conflict, setConflict] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [tested, setTested] = useState<TestTermsResponse | null>(null)

  const validation = useMemo(() => validateTerms(draft), [draft])
  const dirty = JSON.stringify(draft) !== JSON.stringify(config.terms)
  const errorsFor = (prefix: string) =>
    validation.errors.filter((e) => e.path.startsWith(prefix)).map((e) => e.message)

  const save = useMutation({
    mutationFn: () => patchConfig({ baseVersion: config.version, terms: validation.normalized }),
    onSuccess: (res) => {
      client.setQueryData(configKey, res)
      void client.invalidateQueries({ queryKey: ['brief'] })
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) setConflict(true)
      else setSaveError(saveErrorMessage(err))
    },
  })
  const test = useMutation({
    mutationFn: () => testTerms({ terms: validation.normalized }),
    onSuccess: setTested,
  })

  const set = (patch: Partial<TermsConfig>) => {
    setTested(null)
    setSaveError(null)
    setDraft((d) => ({ ...d, ...patch }))
  }
  const setAliases = (key: (typeof ENTITIES)[number]['key'], aliases: string[]) => {
    setTested(null)
    setSaveError(null)
    setDraft((d) => ({ ...d, entities: { ...d.entities, [key]: { ...d.entities[key], aliases } } }))
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Matching terms</CardTitle>
          <CardDescription>
            A post is kept when it matches these lists. Saving creates a new config version that the
            worker picks up on its next tick.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <TermListEditor
            label="IPO terms"
            addLabel="Add IPO term"
            values={draft.ipo_terms}
            onChange={(v) => set({ ipo_terms: v })}
            errors={errorsFor('ipo_terms')}
            warnBare
          />
          <TermListEditor
            label="Hashtags"
            addLabel="Add hashtag"
            values={draft.hashtags}
            onChange={(v) => set({ hashtags: v })}
            errors={errorsFor('hashtags')}
            placeholder="#JioIPO"
          />
          <TermListEditor
            label="Co-occurrence terms"
            addLabel="Add co-occurrence term"
            hint="Words that make an ambiguous mention count, such as IPO or GMP."
            values={draft.cooccurrence_terms}
            onChange={(v) => set({ cooccurrence_terms: v })}
            errors={errorsFor('cooccurrence_terms')}
            warnBare
          />
          <TermListEditor
            label="Negative terms"
            addLabel="Add negative term"
            hint="Posts about these are masked out, e.g. JioStar."
            values={draft.negative_terms}
            onChange={(v) => set({ negative_terms: v })}
            errors={errorsFor('negative_terms')}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Entity aliases</CardTitle>
          <CardDescription>
            Latin, Devanagari and Gujarati spellings for each entity.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          {ENTITIES.map((e) => (
            <TermListEditor
              key={e.key}
              label={`${e.name} aliases`}
              addLabel={`Add ${e.name} alias`}
              values={draft.entities[e.key].aliases}
              onChange={(v) => setAliases(e.key, v)}
              errors={errorsFor(`entities.${e.key}.aliases`)}
              warnBare
            />
          ))}
        </CardContent>
      </Card>

      {conflict ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>Config changed since you opened it, reload</span>
            <Button type="button" size="sm" variant="outline" onClick={onReload}>
              Reload
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {saveError ? (
        <Alert variant="destructive">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      ) : null}
      {test.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{saveErrorMessage(test.error)}</AlertDescription>
        </Alert>
      ) : null}
      {tested ? (
        <Card>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p>
              {`Current: ${tested.matchedCurrent}, draft: ${tested.matchedDraft} of ${tested.total} posts`}
            </p>
            {tested.truncated ? (
              <p className="text-xs text-muted-foreground">Capped at the newest 5,000 posts.</p>
            ) : null}
            {tested.samples.length > 0 ? (
              <ul className="flex flex-col gap-1 text-muted-foreground">
                {tested.samples.map((s, i) => (
                  <li key={i}>
                    <span>{s.text}</span> <span className="text-xs">({s.sourceKey})</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t bg-background py-3">
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {dirty ? 'Unsaved changes' : 'No changes'}
        </span>
        <div className="ml-auto flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!validation.ok || test.isPending}
            onClick={() => test.mutate()}
          >
            Test against last 24h
          </Button>
          <Button
            type="button"
            disabled={!dirty || !validation.ok || save.isPending || conflict}
            onClick={() => {
              setSaveError(null)
              save.mutate()
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}
