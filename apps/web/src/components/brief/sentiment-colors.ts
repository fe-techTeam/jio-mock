import type { Sentiment } from '@jio/core'

/**
 * The only place sentiment colours are spelled. Each is at least 4.5:1 against the page
 * background (white in light mode, #0a0a0a in dark). Colour never carries meaning alone: every
 * use sits next to a label or an aria-label.
 */
export const SENTIMENT_COLORS = {
  light: { positive: '#15803d', neutral: '#64748b', negative: '#b91c1c' },
  dark: { positive: '#4ade80', neutral: '#94a3b8', negative: '#f87171' },
} as const satisfies Record<'light' | 'dark', Record<Sentiment, string>>

/**
 * Tailwind classes with the same values. They are written out in full because Tailwind only
 * generates classes it finds as complete strings; sentiment-colors.test.ts keeps them in step.
 */
export const SENTIMENT_CLASSES: Record<Sentiment, { bar: string; text: string }> = {
  positive: { bar: 'bg-[#15803d] dark:bg-[#4ade80]', text: 'text-[#15803d] dark:text-[#4ade80]' },
  neutral: { bar: 'bg-[#64748b] dark:bg-[#94a3b8]', text: 'text-[#64748b] dark:text-[#94a3b8]' },
  negative: { bar: 'bg-[#b91c1c] dark:bg-[#f87171]', text: 'text-[#b91c1c] dark:text-[#f87171]' },
}
