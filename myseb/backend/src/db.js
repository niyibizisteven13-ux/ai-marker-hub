import fs from 'node:fs';
import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: Number(process.env.MYSEB_DB_POOL || 30) });
export const q = (text, params) => pool.query(text, params);

/** Brings the tables up to date. Safe to run from several servers (or test files) at the same moment: a database lock makes them take turns. */
export async function migrate() {
  const sql = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [727_274_001]);
    await client.query(sql);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [727_274_001]).catch(() => undefined);
    client.release();
  }
}
