const W = 80
const H = 24
const PAD = 2

/** 24h volume, one point per IST hour. Decorative: the numbers are in the row. */
export function Sparkline({ values }: { values: number[] }) {
  const n = values.length
  const max = Math.max(1, ...values)
  const points = values
    .map((v, i) => {
      const x = n <= 1 ? W / 2 : (i / (n - 1)) * W
      const y = H - PAD - (Math.max(0, v) / max) * (H - 2 * PAD)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
      className="text-muted-foreground"
    >
      {n > 0 ? (
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  )
}
