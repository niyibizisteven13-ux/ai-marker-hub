export function isPublicSignupAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ALLOW_PUBLIC_SIGNUP === 'true') return true;
  if (env.ALLOW_PUBLIC_SIGNUP === 'false') return false;
  return env.NODE_ENV !== 'production';
}
