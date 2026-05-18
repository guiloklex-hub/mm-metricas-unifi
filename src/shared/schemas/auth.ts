import { z } from 'zod';

export const loginInputSchema = z.object({
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const setupAdminInputSchema = z.object({
  password: z.string().min(8).max(256),
});
export type SetupAdminInput = z.infer<typeof setupAdminInputSchema>;

export const sessionUserSchema = z.object({
  role: z.literal('admin'),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;
