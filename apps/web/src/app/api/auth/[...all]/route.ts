import { auth } from '@/lib/auth'
import { createAuthRouteHandlers } from '@/lib/auth-route'
import { getDb } from '@/lib/db'

export const runtime = 'nodejs'

// getDb() is lazy; the handlers only touch it per request.
const { GET, POST } = createAuthRouteHandlers({
  auth,
  get db() {
    return getDb().db
  },
})
export { GET, POST }
