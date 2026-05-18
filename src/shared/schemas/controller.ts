import { z } from 'zod';

export const controllerVariantSchema = z.enum(['unifi-os', 'classic']);
export type ControllerVariant = z.infer<typeof controllerVariantSchema>;

export const authModeSchema = z.enum(['api-key', 'local']);
export type AuthMode = z.infer<typeof authModeSchema>;

const baseControllerInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  baseUrl: z
    .string()
    .url()
    .refine(
      (u) => u.startsWith('https://') || u.startsWith('http://'),
      'baseUrl deve começar com http(s)://',
    ),
  variant: controllerVariantSchema.nullable().optional(),
  insecureTls: z.boolean().default(false),
  pollSeconds: z.number().int().min(60).max(3600).default(300),
  enabled: z.boolean().default(true),
});

export const controllerCreateInputSchema = z.discriminatedUnion('authMode', [
  baseControllerInputSchema.extend({
    authMode: z.literal('api-key'),
    apiKey: z.string().min(20).max(256),
  }),
  baseControllerInputSchema.extend({
    authMode: z.literal('local'),
    username: z.string().trim().min(1).max(80),
    password: z.string().min(1).max(256),
  }),
]);
export type ControllerCreateInput = z.infer<typeof controllerCreateInputSchema>;

export const controllerPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  variant: controllerVariantSchema.nullable(),
  authMode: authModeSchema,
  username: z.string().nullable(),
  insecureTls: z.boolean(),
  pollSeconds: z.number().int(),
  enabled: z.boolean(),
  lastSeenAt: z.number().int().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type ControllerPublic = z.infer<typeof controllerPublicSchema>;
