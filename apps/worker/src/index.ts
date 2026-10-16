import { loadWorkerEnv } from './env'
import { createLogger } from './log'
import { startWorker } from './boot'

const logger = createLogger()

async function main() {
  const handle = await startWorker({ env: loadWorkerEnv(), logger })
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'worker stopping')
    handle.stop().then(
      () => process.exit(0),
      (err) => {
        logger.error({ err }, 'shutdown failed')
        process.exit(1)
      },
    )
  }
  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((err) => {
  logger.error({ err }, 'worker boot failed')
  process.exit(1)
})
