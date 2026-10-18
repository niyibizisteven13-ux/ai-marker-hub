import { randomBytes } from 'node:crypto';

let ephemeralJwtSecret: string | undefined;
let ephemeralFileUrlSecret: string | undefined;

function getSecret(
  name: 'JWT_SECRET' | 'FILE_URL_SECRET',
  env: NodeJS.ProcessEnv,
  currentEphemeral: string | undefined,
  setEphemeral: (secret: string) => void,
): string {
  const configured = env[name];
  if (configured && configured.length >= 32) return configured;
  if (env.NODE_ENV === 'production') {
    throw new Error(`${name} must be configured with at least 32 characters in production.`);
  }
  if (currentEphemeral) return currentEphemeral;

  const generated = randomBytes(32).toString('hex');
  setEphemeral(generated);
  console.warn(`[WARN] ${name} is not configured; using an ephemeral non-production key. Set a stable value before deployment.`);
  return generated;
}

export function getJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  return getSecret('JWT_SECRET', env, ephemeralJwtSecret, (secret) => {
    ephemeralJwtSecret = secret;
  });
}

export function getFileUrlSecret(env: NodeJS.ProcessEnv = process.env): string {
  return getSecret('FILE_URL_SECRET', env, ephemeralFileUrlSecret, (secret) => {
    ephemeralFileUrlSecret = secret;
  });
}
