import type { AccuracyResponse } from '@/app/api/accuracy/_lib/compute'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { pct } from './accuracy-header'

const ROWS = [
  ['en', 'EN'],
  ['hinglish', 'Hinglish'],
  ['hi', 'Hindi'],
  ['gu', 'Gujarati'],
] as const

export function LanguageBreakdown({ data }: { data: AccuracyResponse }) {
  return (
    <section className="flex flex-col gap-2" aria-label="Accuracy by language">
      <h2 className="text-sm font-medium">By language</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Language</TableHead>
            <TableHead className="text-right">Posts</TableHead>
            <TableHead className="text-right">Sentiment</TableHead>
            <TableHead className="text-right">Topic</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ROWS.map(([key, label]) => {
            const r = data.byLang[key]
            return (
              <TableRow key={key}>
                <TableCell>{label}</TableCell>
                <TableCell className="text-right tabular-nums">{r ? r.n : 'n/a'}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(r?.sentiment)}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(r?.topic)}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <p className="text-sm text-muted-foreground">
        {data.sarcasm
          ? `Sarcasm subset: ${data.sarcasm.n} posts, sentiment ${pct(data.sarcasm.sentiment)}`
          : 'Sarcasm subset: no sarcastic posts labelled yet'}
      </p>
    </section>
  )
}
