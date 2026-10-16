import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Jio IPO sentiment',
  description: 'Jio IPO sentiment board',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}
