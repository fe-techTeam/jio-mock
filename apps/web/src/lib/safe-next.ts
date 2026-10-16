/** A post-login redirect target: same-origin path only, never /login, otherwise '/'. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/')) return '/'
  if (next.startsWith('//') || next.startsWith('/\\')) return '/'
  if (next === '/login' || next.startsWith('/login?') || next.startsWith('/login/')) return '/'
  return next
}
