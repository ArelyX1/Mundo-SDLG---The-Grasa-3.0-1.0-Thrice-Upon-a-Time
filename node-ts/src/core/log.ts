export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

export function maybeLogger(level: LogLevel = 'info', nodeName = 'jam') {
  const th = LEVELS[level] ?? 1
  const ts = () => new Date().toISOString()
  const fmt = (lvl: LogLevel, msg: string) => `[${ts()}] [${nodeName}] [${lvl.toUpperCase().padEnd(5)}] ${msg}`
  return {
    debug: (m: string) => th <= LEVELS.debug && console.log(fmt('debug', m)),
    info: (m: string) => th <= LEVELS.info && console.log(fmt('info', m)),
    warn: (m: string) => th <= LEVELS.warn && console.warn(fmt('warn', m)),
    error: (m: string) => th <= LEVELS.error && console.error(fmt('error', m)),
  }
}

export type Logger = ReturnType<typeof maybeLogger>