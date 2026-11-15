import crypto from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';
import { config } from './config.js';

// One MySEB process uses up to 30 database connections (a big live class needs them). Test files run side by side against one database,
// and PostgreSQL allows only 100 connections by default, so each test process uses a few.
export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: Number(process.env.MYSEB_DB_POOL || (process.env.NODE_TEST_CONTEXT ? 8 : 30)) });
export const q = (text, params) => pool.query(text, params);

/** Brings the tables up to date. Safe to run from several servers (or test files) at the same moment: a database lock makes them take turns. */
export async function migrate() {
  const sql = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  const version = crypto.createHash('sha256').update(sql).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [727_274_001]);
    // Changing a table locks it, even when nothing changes ("ADD COLUMN IF NOT EXISTS" still locks). So the schema is only run when its
    // text is new to this database: a restart of an up-to-date server touches no table, and cannot deadlock with the queries around it.
    await client.query('CREATE TABLE IF NOT EXISTS myseb_meta (k text PRIMARY KEY, v text NOT NULL)');
    const have = (await client.query("SELECT v FROM myseb_meta WHERE k = 'schema'")).rows[0]?.v;
    if (have !== version) {
      await client.query(sql);
      await client.query("INSERT INTO myseb_meta (k, v) VALUES ('schema', $1) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v", [version]);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [727_274_001]).catch(() => undefined);
    client.release();
  }
}
