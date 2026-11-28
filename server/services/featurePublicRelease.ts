import { z } from 'zod';

export const publicReleaseId = z.string().regex(/^[0-9a-f]{32}$/);
export const publicReleasePrefix = 'feature-public-release:';
export const publicReleaseKey = (id: string) => `${publicReleasePrefix}${id}`;
export const publicReleasePath = (id: string) => `/api/published-app/${id}`;

export const publicReleaseSchema = z.object({
  revision: z.number().int().positive(),
  html: z.string().max(1_000_000),
  monitor: z.object({
    checkedAt: z.string().datetime(),
    checks: z.object({
      rendered: z.boolean(),
      horizontalOverflow: z.boolean(),
      runtimeErrors: z.number().int().nonnegative(),
      controlsWithoutNames: z.number().int().nonnegative(),
    }).nullable(),
  }).optional(),
});

export const publishedAppPolicy = [
  'sandbox allow-scripts', "default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'",
  'img-src data: blob:', 'font-src data:', "form-action 'none'", "base-uri 'none'", "frame-ancestors 'self'",
].join('; ');
