'use client'

import { useState } from 'react'
import { X_TIERS, type XTier } from '@jio/core'
import type { SourcesPatch, XCard } from '@/app/api/sources/_lib/contract'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CONFLICT_TEXT } from './sources-api'
import { usePatchSources } from './use-patch-sources'

const RATE_FIELDS = [
  ['max_pages_per_run', 'Max pages per run'],
  ['cost_per_post_usd', 'Cost per post (USD)'],
] as const

export const TOKEN_PLACEHOLDER_SET = 'Saved - enter a new token to replace'
export const TOKEN_PLACEHOLDER_UNSET = 'Not set'

export function XConfigCard({ x, configVersion }: { x: XCard; configVersion: number }) {
  const [tier, setTier] = useState<string>(x.tier ?? 'none')
  const [limits, setLimits] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(x.rateLimits).map(([k, v]) => [k, String(v)])),
  )
  // The token input never receives a value from props: it only holds what the operator types.
  const [token, setToken] = useState('')
  const p = usePatchSources()

  function submit() {
    const rate_limits: Record<string, number> = {}
    for (const [k, v] of Object.entries(limits)) {
      if (v.trim() !== '' && Number.isFinite(Number(v))) rate_limits[k] = Number(v)
    }
    const body: NonNullable<SourcesPatch['x']> = { x_tier: tier, rate_limits }
    if (token.trim()) body.bearerToken = token
    p.save({ baseVersion: configVersion, x: body }, { onSuccess: () => setToken('') })
  }

  function clearToken() {
    if (!window.confirm('Clear the saved X bearer token?')) return
    p.save({ baseVersion: configVersion, x: { bearerToken: null } })
  }

  const keys = [
    ...RATE_FIELDS.map(([k]) => k as string),
    ...Object.keys(x.rateLimits).filter((k) => !RATE_FIELDS.some(([f]) => f === k)),
  ]
  const label = (k: string) => RATE_FIELDS.find(([f]) => f === k)?.[1] ?? k

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">X configuration</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <p>
          Current mode: <strong>{x.modeLabel}</strong>
        </p>
        <div className="flex flex-col gap-1">
          <Label htmlFor="x-tier">Tier</Label>
          <Select value={tier} onValueChange={setTier}>
            <SelectTrigger id="x-tier" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {X_TIERS.map((t: XTier) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {p.errors['x.x_tier'] ? (
            <p role="alert" className="text-xs text-destructive">
              {p.errors['x.x_tier']}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3">
          {keys.map((k) => (
            <div key={k} className="flex flex-col gap-1">
              <Label htmlFor={`rl-${k}`}>{label(k)}</Label>
              <Input
                id={`rl-${k}`}
                type="number"
                min={0}
                step="any"
                className="w-36"
                value={limits[k] ?? ''}
                onChange={(e) => setLimits((s) => ({ ...s, [k]: e.target.value }))}
              />
              {p.errors[`x.rate_limits.${k}`] ? (
                <p role="alert" className="text-xs text-destructive">
                  {p.errors[`x.rate_limits.${k}`]}
                </p>
              ) : null}
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="x-token">Bearer token (write-only)</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="x-token"
              type="password"
              autoComplete="off"
              className="w-80"
              value={token}
              placeholder={x.credsSet ? TOKEN_PLACEHOLDER_SET : TOKEN_PLACEHOLDER_UNSET}
              aria-invalid={p.errors['x.bearerToken'] ? true : undefined}
              onChange={(e) => setToken(e.target.value)}
            />
            {x.credsSet ? (
              <Button variant="outline" size="sm" disabled={p.saving} onClick={clearToken}>
                Clear token
              </Button>
            ) : null}
          </div>
          {p.errors['x.bearerToken'] ? (
            <p role="alert" className="text-xs text-destructive">
              {p.errors['x.bearerToken']}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={p.saving} onClick={submit}>
            Save X settings
          </Button>
          {p.conflict ? (
            <span role="alert" className="flex items-center gap-2 text-xs text-destructive">
              {CONFLICT_TEXT}
              <Button size="xs" variant="outline" onClick={() => void p.reload()}>
                Reload
              </Button>
            </span>
          ) : null}
          {p.failure ? (
            <span role="alert" className="text-xs text-destructive">
              {p.failure}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
