import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { auth } from '@/lib/auth'
import { safeNext } from '@/lib/safe-next'
import { LoginForm } from './login-form'

export const dynamic = 'force-dynamic'

type Props = { searchParams: Promise<{ next?: string; reason?: string }> }

export default async function LoginPage({ searchParams }: Props) {
  const { next, reason } = await searchParams
  const session = await auth.api.getSession({ headers: await headers() })
  if (session) redirect(safeNext(next))

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold">Jio IPO sentiment</h1>
        <Badge variant="secondary">Private</Badge>
      </div>
      {reason === 'expired' ? (
        <Alert>
          <AlertCircle aria-hidden />
          <AlertDescription>Session expired, sign in again</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Shared team account</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm next={safeNext(next)} />
        </CardContent>
      </Card>
      <p className="text-muted-foreground text-center text-xs">Access is logged</p>
    </main>
  )
}
