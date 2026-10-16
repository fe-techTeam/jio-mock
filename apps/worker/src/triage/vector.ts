// Small dense-vector helpers (plain number[]; 1024 dims in practice).

/** Cosine similarity; 0 when either vector is all-zero or the lengths differ. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na === 0 || nb === 0) return 0
  return dot / Math.sqrt(na * nb)
}

export function l2normalize(v: readonly number[]): number[] {
  let sq = 0
  for (const x of v) sq += x * x
  if (sq === 0) return [...v]
  const n = Math.sqrt(sq)
  return v.map((x) => x / n)
}

/** L2-normalized mean of the vectors; [] for none. */
export function centroid(vs: readonly (readonly number[])[]): number[] {
  if (vs.length === 0) return []
  const dims = vs[0]!.length
  const sum = new Array<number>(dims).fill(0)
  for (const v of vs) {
    for (let i = 0; i < dims; i++) sum[i]! += v[i] ?? 0
  }
  return l2normalize(sum.map((x) => x / vs.length))
}

export function isZeroVector(v: readonly number[]): boolean {
  return v.every((x) => x === 0)
}

/** pgvector text literal, e.g. '[0.1,-2,3]'. Throws on NaN or Infinity. */
export function toPgVector(v: readonly number[]): string {
  for (const x of v) {
    if (!Number.isFinite(x)) throw new Error('toPgVector: non-finite component')
  }
  return `[${v.join(',')}]`
}
