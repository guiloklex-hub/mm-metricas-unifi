import { z } from 'zod';

export const radioSchema = z.enum(['ng', 'na', '6e']);
export type Radio = z.infer<typeof radioSchema>;

export const granularitySchema = z.enum(['5m', '1h', '1d']);
export type Granularity = z.infer<typeof granularitySchema>;

export const metricsQuerySchema = z
  .object({
    from: z.coerce.number().int().positive(),
    to: z.coerce.number().int().positive(),
    granularity: granularitySchema.optional(),
    controllerId: z.string().optional(),
    siteId: z.string().optional(),
    deviceId: z.string().optional(),
    radio: radioSchema.optional(),
    clientMac: z
      .string()
      .regex(/^[0-9a-fA-F:]{17}$/)
      .optional(),
    groupBy: z.enum(['site', 'device', 'radio', 'client']).optional(),
  })
  .refine((v) => v.to > v.from, 'to deve ser maior que from')
  .refine((v) => v.to - v.from <= 366 * 86400, 'janela máxima de 1 ano');
export type MetricsQuery = z.infer<typeof metricsQuerySchema>;

export const metricSampleSchema = z.object({
  ts: z.number().int(),
  controllerId: z.string(),
  siteId: z.string(),
  deviceId: z.string().nullable(),
  radio: radioSchema.nullable(),
  clientMac: z.string().nullable(),
  clientCount: z.number().int().nullable(),
  txBytes: z.number().int().nullable(),
  txPackets: z.number().int().nullable(),
  txDropped: z.number().int().nullable(),
  txErrors: z.number().int().nullable(),
  txRetries: z.number().int().nullable(),
  dTxBytes: z.number().int().nullable(),
  dTxPackets: z.number().int().nullable(),
  dTxDropped: z.number().int().nullable(),
  dTxErrors: z.number().int().nullable(),
  dTxRetries: z.number().int().nullable(),
  retryRate: z.number().nullable(),
  errorRate: z.number().nullable(),
  dropRate: z.number().nullable(),
});
export type MetricSample = z.infer<typeof metricSampleSchema>;
