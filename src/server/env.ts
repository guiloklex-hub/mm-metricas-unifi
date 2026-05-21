import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL deve iniciar com `postgres://` ou `postgresql://`')
    .default('postgresql://localhost:5432/metricas_unifi'),
  MASTER_KEY: z
    .string()
    .min(1, 'MASTER_KEY obrigatório (32 bytes base64)')
    .refine((v) => {
      try {
        return Buffer.from(v, 'base64').length === 32;
      } catch {
        return false;
      }
    }, 'MASTER_KEY deve ser base64 de 32 bytes (gere com `openssl rand -base64 32`)'),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET obrigatório (>= 32 chars; gere com `openssl rand -base64 64`)'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  DEFAULT_POLL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
  RETENTION_5M_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  RETENTION_1H_DAYS: z.coerce.number().int().min(7).max(3650).default(365),
  /**
   * Quantos workers processam a fila de jobs em paralelo. Cada worker é um
   * loop independente que usa `FOR UPDATE SKIP LOCKED` no claim, então N
   * workers não duplicam jobs. Default 1 (compatibilidade); aumente para
   * 3–5 se você tem 10+ controllers com timeouts intermitentes que
   * cumulativamente atrasam o tick de coleta.
   */
  COLLECTOR_WORKERS: z.coerce.number().int().min(1).max(16).default(1),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuração inválida em variáveis de ambiente:\n${issues}`);
  }
  return result.data;
}
