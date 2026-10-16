'use client'

import { Toaster as Sonner, type ToasterProps } from 'sonner'

// shadcn's sonner reads next-themes; this app has no theme provider, so the theme is 'system'.
function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--background)',
          '--normal-text': 'var(--foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
