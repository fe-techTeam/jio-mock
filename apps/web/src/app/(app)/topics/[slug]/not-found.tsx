import Link from 'next/link'

export default function TopicNotFound() {
  return (
    <div className="flex flex-col items-start gap-3 py-8">
      <h1 className="text-xl font-semibold">Topic not found</h1>
      <p className="text-sm text-muted-foreground">
        That talking point does not exist, or the link is malformed.
      </p>
      <Link href="/" className="text-sm font-medium underline underline-offset-4">
        Back to the brief
      </Link>
    </div>
  )
}
