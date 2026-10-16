import { ErrorState, TabSkeleton } from '@/components/states'

export { TabSkeleton }

export function TabError({ onRetry }: { onRetry: () => void }) {
  return <ErrorState message="Could not load this tab." onRetry={onRetry} />
}
