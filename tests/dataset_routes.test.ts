import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';

// SYNTHETIC FIXTURE: invented values used only to exercise the HTTP contract. Not NISR statistics.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nisr-routes-'));
await fs.mkdir(path.join(dir, 'raw'), { recursive: true });
await fs.writeFile(path.join(dir, 'raw', 'f.csv'), 'District,Year,Value\nGasabo,2020,5\nGasabo,2021,7\n');
await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, datasets: [{
  id: 'fixture-routes', title: 'Fixture routes table', organization: 'Fixture org (not NISR)', sourceUrl: 'https://example.test/f',
  publicationDate: '2022-01-01', referencePeriod: '2020-2021', geographicCoverage: 'Fixture', license: 'test-only',
  format: 'csv', file: 'raw/f.csv', checksum: '', table: { indicator: 'Fixture rate', geographyColumn: 'District', periodColumn: 'Year', valueColumn: 'Value', unit: '%' },
}] }));
process.env.NISR_DATA_DIR = dir;

const { nisrPipeline } = await import('../server/services/AiService.js');
const { default: datasetRoutes } = await import('../server/routes/datasetRoutes.js');
await nisrPipeline.buildIndex({ writeChecksums: true });

const app = express();
app.use(express.json());
app.use((req, _res, next) => { (req as any).requestId = 'req-route-test'; next(); });
app.use('/api/datasets', datasetRoutes);
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/datasets`;

test.after(async () => {
  server.close();
  await fs.rm(dir, { recursive: true, force: true });
});

const post = (body: unknown) => fetch(`${base}/nisr/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('GET /nisr/datasets lists indexed datasets with source metadata', async () => {
  const res = await fetch(`${base}/nisr/datasets`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.datasets.length, 1);
  assert.equal(body.datasets[0].id, 'fixture-routes');
  assert.equal(body.datasets[0].sourceUrl, 'https://example.test/f');
  assert.equal(body.requestId, 'req-route-test');
  assert.match(body.indexVersion, /^[a-f0-9]{16}$/);
});

test('POST /nisr/query returns computed stats, change and validated artifacts', async () => {
  const res = await post({ indicator: 'Fixture rate', geography: 'Gasabo' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.stats.mean, 6);
  assert.equal(body.change.percent, 40);
  assert.deepEqual(body.artifacts.map((a: any) => a.type).sort(), ['chart', 'table']);
  assert.equal(body.sources[0].title, 'Fixture routes table');
  assert.equal(body.requestId, 'req-route-test');
});

test('POST /nisr/query validates input strictly', async () => {
  for (const bad of [{}, { indicator: '' }, { indicator: 'x', sql: 'DROP TABLE' }, { datasetId: '../etc' }, { indicator: 'x', chartType: 'html' }]) {
    const res = await post(bad);
    assert.equal(res.status, 400, JSON.stringify(bad));
    const body = await res.json();
    assert.equal(body.code, 'INVALID_REQUEST');
  }
});

test('GET /nisr/search requires q and returns citations', async () => {
  assert.equal((await fetch(`${base}/nisr/search`)).status, 400);
  const body = await (await fetch(`${base}/nisr/search?q=${encodeURIComponent('fixture rate Gasabo 2021')}`)).json();
  assert.ok(body.hits.length > 0);
  assert.equal(body.hits[0].citation.datasetId, 'fixture-routes');
  assert.equal(body.hits[0].citation.source, 'data/nisr/raw/f.csv');
});
