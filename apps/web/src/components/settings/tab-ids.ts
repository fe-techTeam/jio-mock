// Plain module (no 'use client'): the settings page calls parseTab on the server.
export const SETTINGS_TABS = [
  { id: 'keywords', label: 'Keywords' },
  { id: 'topics', label: 'Topics' },
  { id: 'access', label: 'Access and retention' },
] as const
export type SettingsTabId = (typeof SETTINGS_TABS)[number]['id']

export function parseTab(v: string | string[] | undefined): SettingsTabId {
  const s = Array.isArray(v) ? v[0] : v
  return SETTINGS_TABS.some((t) => t.id === s) ? (s as SettingsTabId) : 'keywords'
}
