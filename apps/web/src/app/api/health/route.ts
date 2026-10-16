import { checkHealth } from '@/lib/health'
import { pingDb } from '@/lib/db-ping'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Public liveness check. A database outage still returns 200: the process itself is alive.
export async function GET() {
  return Response.json(await checkHealth(pingDb), {
    status: 200,
    headers: { 'cache-control': 'no-store' },
  })
}
