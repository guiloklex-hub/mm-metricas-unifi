import { BUCKET_1D_SECONDS, BUCKET_1H_SECONDS, BUCKET_5M_SECONDS } from '@shared/constants.ts';
import type { Granularity } from '@shared/schemas/metrics.ts';

const BUCKET_SECONDS: Record<Granularity, number> = {
  '5m': BUCKET_5M_SECONDS,
  '1h': BUCKET_1H_SECONDS,
  '1d': BUCKET_1D_SECONDS,
};

export function bucketTs(epochSeconds: number, granularity: Granularity): number {
  const size = BUCKET_SECONDS[granularity];
  return Math.floor(epochSeconds / size) * size;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function chooseGranularity(fromSec: number, toSec: number): Granularity {
  const windowSec = Math.max(0, toSec - fromSec);
  if (windowSec <= 2 * 86400) return '5m';
  if (windowSec <= 60 * 86400) return '1h';
  return '1d';
}
