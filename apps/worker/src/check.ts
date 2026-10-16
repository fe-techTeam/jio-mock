import { loadWorkerEnv } from './env'
import { createLogger } from './log'
import { startWorker } from './boot'

const logger = createLogger()

try {
  const handle = await startWorker({ env: loadWorkerEnv(), logger })
  await handle.stop()
  process.exit(0)
} catch (err) {
  logger.error({ err }, 'worker check failed: database unreachable or misconfigured')
  process.exit(1)
}
