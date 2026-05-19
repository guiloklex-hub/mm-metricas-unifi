import pino, { type Logger, type LoggerOptions } from 'pino';

const REDACT_PATHS = [
  'password',
  '*.password',
  'apiKey',
  '*.apiKey',
  'api_key',
  '*.api_key',
  'apiKeyEnc',
  '*.apiKeyEnc',
  'passwordEnc',
  '*.passwordEnc',
  'api_key_enc',
  '*.api_key_enc',
  'password_enc',
  '*.password_enc',
  'token',
  '*.token',
  'jwt',
  '*.jwt',
  'twoFactorSecret',
  '*.twoFactorSecret',
  'authorization',
  '*.authorization',
  'cookie',
  '*.cookie',
  'X-API-KEY',
  'X-CSRF-Token',
  'set-cookie',
  '*.set-cookie',
  'masterKey',
  '*.masterKey',
  'jwtSecret',
  '*.jwtSecret',
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
