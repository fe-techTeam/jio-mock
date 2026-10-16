'use client'

import Link from 'next/link'
import { KeywordsTab } from './keywords-tab'
import { TopicsTab } from './topics-tab'
import { AccessTab } from './access-tab'

import { SETTINGS_TABS, type SettingsTabId } from './tab-ids'

// Re-exported for existing importers; server code must import from './tab-ids' instead, because a
// function exported from a 'use client' module cannot be called on the server.
export { SETTINGS_TABS, parseTab, type SettingsTabId } from './tab-ids'

/** Three links driven by ?tab=, so each tab is deep-linkable. */
export function SettingsTabs({ tab }: { tab: SettingsTabId }) {
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Settings sections" className="flex flex-wrap gap-1 border-b text-sm">
        {SETTINGS_TABS.map((t) => (
          <Link
            key={t.id}
            href={t.id === 'keywords' ? '/settings' : `/settings?tab=${t.id}`}
            aria-current={t.id === tab ? 'page' : undefined}
            className={
              t.id === tab
                ? 'border-b-2 border-foreground px-3 py-2 font-medium'
                : 'px-3 py-2 text-muted-foreground hover:text-foreground'
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === 'keywords' ? <KeywordsTab /> : tab === 'topics' ? <TopicsTab /> : <AccessTab />}
    </div>
  )
}
