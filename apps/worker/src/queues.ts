import type PgBoss from 'pg-boss'

export const QUEUES = [
  'fetch-source',
  'classify-batch',
  'rollup',
  'summaries',
  'emerging',
  'retention',
] as const

export type QueueName = (typeof QUEUES)[number]

/** pg-boss v10 requires a queue to exist before send; createQueue is idempotent. */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const name of QUEUES) await boss.createQueue(name)
}
