export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: boolean;
  isRetryable?: (err: unknown) => boolean;
  onAttempt?: (attempt: number, err: unknown, nextDelayMs: number) => void;
}

const DEFAULTS: Required<Omit<RetryOptions, 'isRetryable' | 'onAttempt'>> = {
  maxAttempts: 3,
  initialDelayMs: 200,
  maxDelayMs: 10_000,
  factor: 2,
  jitter: true,
};

/**
 * Backoff exponencial com jitter opcional.
 * - Total de tentativas inclui a primeira.
 * - `isRetryable` é avaliado a cada falha; se retornar false, lança imediatamente.
 */
export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const cfg = { ...DEFAULTS, ...opts };
  let lastErr: unknown;
  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (opts.isRetryable && !opts.isRetryable(err)) throw err;
      if (attempt === cfg.maxAttempts) break;
      const base = Math.min(cfg.maxDelayMs, cfg.initialDelayMs * cfg.factor ** (attempt - 1));
      const delay = cfg.jitter ? base * (0.5 + Math.random() * 0.5) : base;
      opts.onAttempt?.(attempt, err, delay);
      await sleep(delay);
    }
  }
  throw lastErr;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
