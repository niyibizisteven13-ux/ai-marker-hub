import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { prisma } from '../server/db.js';
import { getJwtSecret } from '../server/auth/secrets.js';
import { reportWorkbook, type MySebReport } from '../server/services/mySebReport.js';

const EXAM = randomUUID(); const S1 = randomUUID(); const S2 = randomUUID();
const REPORT: MySebReport = {
  exam: { title: 'Biology midterm', status: 'ended', leave_action: 'pause', live_mode: 'pictures', created_at: '2026-11-15T08:00:00Z', ends_at: '2026-11-15T10:00:00Z' },
  students: [
    { id: S1, student_name: 'Aline Uwase', status: 'ENDED', client_type: 'desktop', platform: 'win32', started_at: '2026-11-15T08:05:00Z', deadline_at: '2026-11-15T09:05:00Z', ended_at: '2026-11-15T08:58:00Z', end_reason: 'student_exit', violation_count: 0 },
    { id: S2, student_name: 'Eric Mugisha', status: 'ENDED', client_type: 'mobile', platform: 'android', started_at: '2026-11-15T08:06:00Z', deadline_at: '2026-11-15T09:06:00Z', ended_at: '2026-11-15T09:06:00Z', end_reason: 'time_up', violation_count: 4 },
  ],
  events: [
    { session_id: S2, type: 'background', detail: { state: 'paused' }, created_at: '2026-11-15T08:20:00Z' },
    { session_id: S2, type: 'heartbeat_lost', detail: {}, created_at: '2026-11-15T08:21:00Z' },
    { session_id: S2, type: 'forbidden_app', detail: { apps: ['anydesk', 'obs'] }, created_at: '2026-11-15T08:30:00Z' },
    { session_id: S2, type: 'mystery_new_type', detail: null, created_at: '2026-11-15T08:31:00Z' },
  ],
};
const load = async (b: Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(b as any); return wb; };

test('the report workbook: a row per student, a plain-words timeline, and a note that it is evidence not proof', async () => {
  const f = await reportWorkbook(REPORT);
  assert.equal(f.name, 'Biology midterm MySEB report.xlsx');
  const wb = await load(f.data);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Students', 'Timeline', 'About']);
  const st = wb.getWorksheet('Students')!;
  assert.deepEqual([st.getRow(2).getCell(1).value, st.getRow(2).getCell(6).value, st.getRow(2).getCell(7).value], ['Aline Uwase', 'Student ended it', 0]);
  assert.deepEqual([st.getRow(3).getCell(3).value, st.getRow(3).getCell(6).value, st.getRow(3).getCell(7).value, st.getRow(3).getCell(8).value, st.getRow(3).getCell(9).value], ['mobile · android', 'Time was up', 4, 1, 1], 'one leave and one lost connection');
  const tl = wb.getWorksheet('Timeline')!;
  assert.deepEqual(Array.from({ length: 4 }, (_, i) => tl.getRow(i + 2).getCell(3).value), ['Left the app', 'Lost connection', 'A remote-control or recording app was running', 'mystery_new_type'], 'unknown types still show');
  assert.equal(tl.getRow(4).getCell(4).value, 'apps: anydesk, obs'); assert.equal(tl.getRow(2).getCell(2).value, 'Eric Mugisha');
  assert.match(String(wb.getWorksheet('About')!.getRow(7).getCell(1).value), /evidence to consider, not proof.*no pictures, video or sound/);
});

test('the route: the owner downloads it; another lecturer, a visitor and a test nobody joined do not', async () => {
  const owner = `lect-${randomUUID().slice(0, 8)}`; const other = `lect-${randomUUID().slice(0, 8)}`;
  for (const id of [owner, other]) await (prisma as any).user.create({ data: { id, email: `${id}@example.org`, passwordHash: 'x' } }).catch(() => undefined);
  const fake = express(); fake.use(express.json());
  fake.use((req, res, next) => (req.get('authorization') === 'Bearer svc-key' ? next() : res.status(401).json({ error: 'no' })));
  fake.get('/api/exams/:id/report', (req, res) => (req.params.id === EXAM ? res.json(REPORT) : res.status(404).json({ error: 'not found' })));
  const fakeSrv = fake.listen(0);
  process.env.MYSEB_URL = `http://127.0.0.1:${(fakeSrv.address() as any).port}`; process.env.MYSEB_SERVICE_KEY = 'svc-key';
  const { createMySebOwnerRouter } = await import('../server/routes/mySebRoutes.js');
  const joined = await (prisma as any).applicationForm.create({ data: { id: randomUUID(), userId: owner, title: 'Biology midterm', schema: JSON.stringify({ title: 'x', exam: { requireMyseb: true, mysebExamId: EXAM } }) } });
  const empty = await (prisma as any).applicationForm.create({ data: { id: randomUUID(), userId: owner, title: 'Nobody yet', schema: JSON.stringify({ title: 'y', exam: { requireMyseb: true } }) } });
  const app = express(); app.use('/api/forms', createMySebOwnerRouter()); const srv = app.listen(0); const base = `http://127.0.0.1:${(srv.address() as any).port}/api/forms`;
  try {
    const bearer = (uid: string) => ({ Authorization: `Bearer ${jwt.sign({ userId: uid }, getJwtSecret(), { algorithm: 'HS256', issuer: 'bwenge', audience: 'bwenge-web', expiresIn: 60 })}` });
    const ok = await fetch(`${base}/${joined.id}/myseb/report.xlsx`, { headers: bearer(owner) });
    assert.equal(ok.status, 200); assert.match(ok.headers.get('content-type') ?? '', /spreadsheetml/); assert.match(ok.headers.get('content-disposition') ?? '', /MySEB report\.xlsx/);
    assert.equal((await load(Buffer.from(await ok.arrayBuffer()))).getWorksheet('Students')!.rowCount, 3);
    assert.equal((await fetch(`${base}/${joined.id}/myseb/report.xlsx`, { headers: bearer(other) })).status, 404, "another lecturer cannot read someone else's test");
    assert.equal((await fetch(`${base}/${joined.id}/myseb/report.xlsx`)).status, 401);
    assert.equal((await fetch(`${base}/${empty.id}/myseb/report.xlsx`, { headers: bearer(owner) })).status, 404);
  } finally { srv.close(); fakeSrv.close(); }
});
