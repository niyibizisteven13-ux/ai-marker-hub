import os from 'node:os';

/**
 * Which part this server plays when Bwenge runs on several servers.
 *  - "primary" (the default, and the only role on a single server): runs the scheduled work that must happen
 *    once for the whole site: payment checks, renewal reminders, file and record clean-up, re-indexing, and
 *    the Telegram webhook registration.
 *  - "web": serves the site and the API and runs the jobs its own users start; no site-wide schedules.
 */
export type NodeRole = 'primary' | 'web';

export const nodeRole = (): NodeRole => (process.env.NODE_ROLE === 'web' ? 'web' : 'primary');
export const isPrimary = () => nodeRole() === 'primary';
export const nodeName = () => process.env.NODE_NAME || os.hostname();
