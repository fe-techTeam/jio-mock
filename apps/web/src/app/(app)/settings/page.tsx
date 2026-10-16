import type { Metadata } from 'next'
import { SettingsTabs } from '@/components/settings/settings-tabs'
import { parseTab } from '@/components/settings/tab-ids'

export const metadata: Metadata = { title: 'Settings' }
export const dynamic = 'force-dynamic'

type Props = { searchParams: Promise<{ tab?: string | string[] }> }

export default async function SettingsPage({ searchParams }: Props) {
  const { tab } = await searchParams
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <SettingsTabs tab={parseTab(tab)} />
    </div>
  )
}
