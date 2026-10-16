import pino, { type Logger, type LoggerOptions } from 'pino'

export function createLogger(opts?: LoggerOptions): Logger {
  return pino({ ...opts, base: { app: 'worker' } })
}
