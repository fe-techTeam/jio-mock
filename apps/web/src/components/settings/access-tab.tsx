'use client'

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { useState } from 'react'
import type { AuditItem, ConfigResponse, RetentionDays } from '@/app/api/config/_lib/contract'
import { validateRetention, validateThresholds } from '@/app/api/config/_lib/validate'
import { formatIst } from '@/components/shell/format'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ApiError } from '@/lib/api'
import {
  auditKey,
  configKey,
  getAudit,
  getSettingsConfig,
  patchConfig,
  saveErrorMessage,
} from './api'
import { TabError, TabSkeleton } from './tab-states'

export function AccessTab() {
  const q = useQuery({ queryKey: configKey, queryFn: getSettingsConfig })
  return (
    <div className="flex flex-col gap-4">
      {q.isPending ? (
        <TabSkeleton label="Loading access settings" />
      ) : q.isError && !q.data ? (
        <TabError onRetry={() => q.refetch()} />
      ) : (
        <LimitsCard key={q.data!.version} config={q.data!} onReload={() => q.refetch()} />
      )}
      <PrivacyCard />
      <AuditCard />
    </div>
  )
}

const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s))

function LimitsCard({ config, onReload }: { config: ConfigResponse; onReload: () => void }) {
  const client = useQueryClient()
  const [retention, setRetention] = useState<Record<keyof RetentionDays, string>>({
    raw_json: String(config.retentionDays.raw_json),
    post_text: String(config.retentionDays.post_text),
    authors: String(config.retentionDays.authors),
  })
  const [split, setSplit] = useState(String(config.minItemsForSplit))
  const [active, setActive] = useState(String(config.activeMinItems24h))
  const [conflict, setConflict] = useState(false)

  const days: RetentionDays = {
    raw_json: num(retention.raw_json),
    post_text: num(retention.post_text),
    authors: num(retention.authors),
  }
  const errors = [
    ...validateRetention(days),
    ...validateThresholds({ minItemsForSplit: num(split), activeMinItems24h: num(active) }),
  ]
  const dirty =
    days.raw_json !== config.retentionDays.raw_json ||
    days.post_text !== config.retentionDays.post_text ||
    days.authors !== config.retentionDays.authors ||
    num(split) !== config.minItemsForSplit ||
    num(active) !== config.activeMinItems24h

  const save = useMutation({
    mutationFn: () =>
      patchConfig({
        baseVersion: config.version,
        retentionDays: days,
        minItemsForSplit: num(split),
        activeMinItems24h: num(active),
      }),
    onSuccess: (res) => {
      client.setQueryData(configKey, res)
      void client.invalidateQueries({ queryKey: ['brief'] })
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) setConflict(true)
    },
  })

  const field = (label: string, value: string, set: (v: string) => void, path: string) => (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium" htmlFor={path}>
        {label}
      </label>
      <Input
        id={path}
        type="number"
        inputMode="numeric"
        value={value}
        aria-invalid={errors.some((e) => e.path.endsWith(path))}
        onChange={(e) => set(e.target.value)}
      />
    </div>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Retention and thresholds</CardTitle>
        <CardDescription>
          Rollups and market points: kept indefinitely. Changes apply at the next retention run.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-3">
          {field(
            'Raw payloads (days)',
            retention.raw_json,
            (v) => setRetention((r) => ({ ...r, raw_json: v })),
            'raw_json',
          )}
          {field(
            'Post text (days)',
            retention.post_text,
            (v) => setRetention((r) => ({ ...r, post_text: v })),
            'post_text',
          )}
          {field(
            'Author rows (days)',
            retention.authors,
            (v) => setRetention((r) => ({ ...r, authors: v })),
            'authors',
          )}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {field('Minimum items for a sentiment split', split, setSplit, 'minItemsForSplit')}
          {field('Active-topic threshold (items in 24h)', active, setActive, 'activeMinItems24h')}
        </div>
        {errors.map((e) => (
          <p key={e.path + e.message} role="alert" className="text-xs text-destructive">
            {e.message}
          </p>
        ))}
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
        {save.isError && !conflict ? (
          <Alert variant="destructive">
            <AlertDescription>{saveErrorMessage(save.error)}</AlertDescription>
          </Alert>
        ) : null}
        <div>
          <Button
            type="button"
            disabled={!dirty || errors.length > 0 || save.isPending || conflict}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function PrivacyCard() {
  return (
    <Card>
      <CardContent className="flex items-center gap-3">
        <Lock className="size-4 text-muted-foreground" aria-hidden />
        {/* Locked: no handler, no request. Only a legal decision and a code change can enable it. */}
        <button
          type="button"
          role="switch"
          aria-checked={false}
          aria-label="Person-level views"
          disabled
          className="relative inline-flex h-5 w-9 shrink-0 cursor-not-allowed items-center rounded-full bg-input opacity-60"
        >
          <span className="ml-0.5 size-4 rounded-full bg-background shadow" />
        </button>
        <span className="text-sm">Person-level views: Off, pending legal review</span>
      </CardContent>
    </Card>
  )
}

function detailSummary(d: Record<string, unknown>): string {
  const s = Object.entries(d)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(', ')
  return s.length > 120 ? `${s.slice(0, 117)}...` : s
}

function AuditCard() {
  const q = useInfiniteQuery({
    queryKey: auditKey,
    queryFn: ({ pageParam }) => getAudit(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
  const items: AuditItem[] = q.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <CardDescription>Sign-ins, views, relabels, config and topic changes.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {q.isPending ? (
          <TabSkeleton label="Loading audit log" />
        ) : q.isError && !q.data ? (
          <TabError onRetry={() => q.refetch()} />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events yet</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time (IST)</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i, n) => (
                <TableRow key={`${i.at}-${n}`}>
                  <TableCell className="whitespace-nowrap">{formatIst(i.at, 'datetime')}</TableCell>
                  <TableCell>{i.kind}</TableCell>
                  <TableCell>{i.ip ?? '-'}</TableCell>
                  <TableCell className="max-w-md truncate text-muted-foreground">
                    {detailSummary(i.detail)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {q.hasNextPage ? (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={q.isFetchingNextPage}
              onClick={() => void q.fetchNextPage()}
            >
              Load more
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
