import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const LABELS = ['Negative', 'Neutral', 'Positive'] as const

/** Rows are the gold (operator) label, columns the model label. */
export function ConfusionMatrix({ matrix }: { matrix: number[][] }) {
  return (
    <section className="flex flex-col gap-2" aria-label="Sentiment confusion matrix">
      <h2 className="text-sm font-medium">Sentiment confusion (gold rows, model columns)</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Gold \ Model</TableHead>
            {LABELS.map((l) => (
              <TableHead key={l} className="text-right">
                {l}
              </TableHead>
            ))}
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {LABELS.map((label, g) => {
            const row = matrix[g] ?? [0, 0, 0]
            return (
              <TableRow key={label}>
                <TableCell className="font-medium">{label}</TableCell>
                {row.map((n, m) => (
                  <TableCell
                    key={LABELS[m]}
                    className={`text-right tabular-nums ${g === m ? 'font-semibold' : ''}`}
                  >
                    {n}
                  </TableCell>
                ))}
                <TableCell className="text-right tabular-nums">
                  {row.reduce((a, b) => a + b, 0)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </section>
  )
}
