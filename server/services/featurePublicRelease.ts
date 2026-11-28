import { z } from 'zod';

export const publicReleaseId = z.string().regex(/^[0-9a-f]{32}$/);
export const publicReleaseKey = (id: string) => `feature-public-release:${id}`;
export const publicReleasePath = (id: string) => `/api/published-app/${id}`;

export const publicReleaseSchema = z.object({
  revision: z.number().int().positive(),
  html: z.string().max(1_000_000),
});

export const publishedAppPolicy = [
  'sandbox allow-scripts', "default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'",
  'img-src data: blob:', 'font-src data:', "form-action 'none'", "base-uri 'none'", "frame-ancestors 'self'",
].join('; ');
