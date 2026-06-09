type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel: LogLevel =
  (process.env.PDF_PIPELINE_LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[configuredLevel];
}

function formatMessage(scope: string, message: string, meta?: unknown): string {
  const base = `[PdfPipeline:${scope}] ${message}`;
  if (meta === undefined) return base;
  try {
    return `${base} ${typeof meta === 'string' ? meta : JSON.stringify(meta)}`;
  } catch {
    return base;
  }
}

export function createLogger(scope: string) {
  return {
    debug(message: string, meta?: unknown) {
      if (shouldLog('debug')) console.debug(formatMessage(scope, message, meta));
    },
    info(message: string, meta?: unknown) {
      if (shouldLog('info')) console.log(formatMessage(scope, message, meta));
    },
    warn(message: string, meta?: unknown) {
      if (shouldLog('warn')) console.warn(formatMessage(scope, message, meta));
    },
    error(message: string, meta?: unknown) {
      if (shouldLog('error')) console.error(formatMessage(scope, message, meta));
    },
  };
}
