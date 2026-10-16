// IST time helpers. India has no DST, so plain epoch arithmetic on a fixed offset is exact
// and independent of process.env.TZ. Exchange holidays are not modelled.
export const IST_OFFSET_MS = 330 * 60_000
export const MARKET_OPEN_MIN_IST = 555 // 09:15
export const MARKET_CLOSE_MIN_IST = 930 // 15:30

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export interface IstParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  /** 0 = Sunday .. 6 = Saturday */
  weekday: number
}

export function toIstParts(d: Date): IstParts {
  const s = new Date(d.getTime() + IST_OFFSET_MS)
  return {
    year: s.getUTCFullYear(),
    month: s.getUTCMonth() + 1,
    day: s.getUTCDate(),
    hour: s.getUTCHours(),
    minute: s.getUTCMinutes(),
    second: s.getUTCSeconds(),
    weekday: s.getUTCDay(),
  }
}

/** Mon-Fri, [09:15, 15:30) IST. */
export function isIndianMarketHours(d: Date): boolean {
  const p = toIstParts(d)
  if (p.weekday === 0 || p.weekday === 6) return false
  const min = p.hour * 60 + p.minute
  return min >= MARKET_OPEN_MIN_IST && min < MARKET_CLOSE_MIN_IST
}

function floorTo(d: Date, stepMs: number): Date {
  const shifted = d.getTime() + IST_OFFSET_MS
  return new Date(Math.floor(shifted / stepMs) * stepMs - IST_OFFSET_MS)
}

export function bucketStart15m(d: Date): Date {
  return floorTo(d, 15 * 60_000)
}

export function hourStartIst(d: Date): Date {
  return floorTo(d, 60 * 60_000)
}

export function formatIst(d: Date): string {
  const p = toIstParts(d)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${pad(p.hour)}:${pad(p.minute)} IST`
}
