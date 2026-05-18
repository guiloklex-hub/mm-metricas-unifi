import pino, { type Logger, type LoggerOptions } from 'pino';

const REDACT_PATHS = [
  'password',
  '*.password',
  'apiKey',
  '*.apiKey',
  'token',
  '*.token',
  'authorization',
  '*.authorization',
  'cookie',
  '*.cookie',
  'X-API-KEY',
  'X-CSRF-Token',
  'set-cookie',
  '*.set-cookie',
];

export interface CreateLoggerOptions {
  level?: string;
  pretty?: boolean;
  name?: string;
}

export function createLogger(opts: CreateLoggerOptions = {}): Logger {
  const baseOpts: LoggerOptions = {
    level: opts.level ?? 'info',
    name: opts.name ?? 'metricas-unifi',
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (opts.pretty) {
    return pino({
      ...baseOpts,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss' },
      },
    });
  }

  return pino(baseOpts);
}
