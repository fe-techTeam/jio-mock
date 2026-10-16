'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'

export function SignOutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function signOut() {
    setPending(true)
    try {
      await authClient.signOut()
    } finally {
      router.push('/login')
      router.refresh()
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={signOut} disabled={pending} aria-label="Sign out">
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
      Sign out
    </Button>
  )
}
