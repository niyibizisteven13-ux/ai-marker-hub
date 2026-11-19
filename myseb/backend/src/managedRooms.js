import express from 'express';
import QRCode from 'qrcode';
import { config } from './config.js';
import { randomBytes } from 'node:crypto';
import { q } from './db.js';
import { newToken, tokenHash, rateLimit } from './security.js';

export const managedRooms = express.Router();
const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const limit = (max) => rateLimit({ windowMs: 60000, max });
const label = (s, max) =>
  typeof s === 'string' && s.trim().length <= max && s.trim();
const key = (req) =>
  tokenHash((req.get('authorization') || '').replace(/^Bearer /i, ''));
function address(s) {
  if (!label(s, 4096)) return null;
  try {
    const u = new URL(s);
    if (u.protocol === 'https:' && !u.username && !u.password) return u;
  } catch {}
  return null;
}
function policy(body) {
  const site = address(body?.url);
  if (!site || !['single', 'selected', 'open'].includes(body.mode)) return null;
  const extras = body.mode === 'selected' ? body.sites : [];
  if (
    !Array.isArray(extras) ||
    extras.length > 20 ||
    !extras.every((s) => address(s))
  )
    return null;
  return {
    url: site.href,
    mode: body.mode,
    origins: [
      ...new Set([site.origin, ...extras.map((s) => address(s).origin)])
    ]
  };
}
managedRooms.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
managedRooms.post(
  '/',
  limit(20),
  asyncRoute(async (req, res) => {
    const { title, startsAt, minutes } = req.body || {};
    const p = policy(req.body);
    const now = Date.now(),
      start = startsAt ? Date.parse(startsAt) : now;
    if (
      !p ||
      !label(title, 100) ||
      !Number.isFinite(start) ||
      start < now - 60000 ||
      start > now + 30 * 86400000 ||
      !Number.isInteger(minutes) ||
      minutes < 1 ||
      minutes > 1440
    )
      return res.status(400).json({
        error:
          'Check the room name, HTTPS sites, start time and duration (1–1440 minutes).'
      });
    const code = 'RM-' + randomBytes(6).toString('hex').toUpperCase(),
      host = newToken();
    await q(
      'INSERT INTO managed_rooms(code,host_hash,title,policy,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6)',
      [
        code,
        tokenHash(host),
        title.trim(),
        p,
        new Date(start),
        new Date(start + minutes * 60000)
      ]
    );
    res.status(201).json({ code, host });
  })
);
managedRooms.post(
  '/:code/join',
  limit(2400),
  asyncRoute(async (req, res) => {
    const name = label(req.body?.name, 80),
      token = req.body?.token;
    if (!name || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))
      return res.status(400).json({ error: 'Enter your name and room code.' });
    const r = await q(
      `INSERT INTO managed_members(room,token_hash,name)
    SELECT code,$2,$3 FROM managed_rooms WHERE code=$1 AND NOT closed AND ends_at>now()
    ON CONFLICT(room,token_hash) DO UPDATE SET seen=now() RETURNING id`,
      [req.params.code, tokenHash(token), name]
    );
    if (!r.rowCount)
      return res
        .status(404)
        .json({ error: 'Room unavailable. Check the code and closing time.' });
    res.json({ id: r.rows[0].id });
  })
);
managedRooms.post(
  '/:code/sync',
  asyncRoute(async (req, res) => {
    const { applied, request, site } = req.body || {};
    if (
      !Number.isInteger(applied) ||
      applied < 0 ||
      applied > 2147483647 ||
      ![undefined, 'help', 'exit'].includes(request)
    )
      return res.sendStatus(400);
    const { rows } = await q(
      `UPDATE managed_members m SET seen=now(),applied=$3,
    current_site=CASE WHEN NOT r.closed AND NOT m.released AND now() BETWEEN r.starts_at AND r.ends_at THEN $5 ELSE NULL END,
    request=COALESCE($4,m.request) FROM managed_rooms r
    WHERE m.room=$1 AND m.token_hash=$2 AND r.code=m.room
    RETURNING r.policy,r.revision,r.title,r.starts_at,r.ends_at,r.closed,m.released,m.request,m.reply,now() AS server_time`,
      [
        req.params.code,
        key(req),
        applied,
        request ?? null,
        address(site)?.origin ?? null
      ]
    );
    if (!rows.length)
      return res.status(404).json({ error: 'Session unavailable.' });
    res.json(rows[0]);
  })
);
managedRooms.use(
  '/:code',
  asyncRoute(async (req, res, next) => {
    const { rows } = await q(
      'SELECT code,title,policy,activities,revision,starts_at,ends_at,closed FROM managed_rooms WHERE code=$1 AND host_hash=$2',
      [req.params.code, key(req)]
    );
    if (!rows.length)
      return res.status(403).json({ error: 'Host access required.' });
    req.managed = rows[0];
    next();
  })
);
managedRooms.get(
  '/:code',
  asyncRoute(async (req, res) => {
    const { rows } = await q(
      `SELECT id,name,current_site,applied,request,released,seen,
    seen>now()-interval '30 seconds' AND NOT released AS connected FROM managed_members WHERE room=$1 ORDER BY name,id`,
      [req.params.code]
    );
    res.json({ ...req.managed, members: rows });
  })
);
managedRooms.get(
  '/:code/qr',
  asyncRoute(async (req, res) => {
    res
      .type('png')
      .send(
        await QRCode.toBuffer(
          config.publicUrl + '/room/?room=' + req.params.code
        )
      );
  })
);
managedRooms.post(
  '/:code/activities',
  asyncRoute(async (req, res) => {
    const name = label(req.body?.name, 100),
      saved = policy(req.body);
    if (!name || !saved)
      return res
        .status(400)
        .json({ error: 'Enter an activity name and HTTPS site.' });
    const result = await q(
      `UPDATE managed_rooms SET activities=activities || $2::jsonb
    WHERE code=$1 AND NOT closed AND ends_at>now() AND jsonb_array_length(activities)<30`,
      [req.params.code, JSON.stringify([{ name, ...saved }])]
    );
    if (!result.rowCount)
      return res
        .status(409)
        .json({ error: 'Room ended or the 30 activity limit was reached.' });
    res.json({ ok: true });
  })
);
managedRooms.put(
  '/:code/policy',
  asyncRoute(async (req, res) => {
    const p = policy(req.body);
    if (!p)
      return res
        .status(400)
        .json({ error: 'Use a valid HTTPS site and browsing setting.' });
    const result = await q(
      'UPDATE managed_rooms SET policy=$2,revision=revision+1 WHERE code=$1 AND NOT closed AND ends_at>now() AND revision=$3',
      [req.params.code, p, req.body.revision]
    );
    if (!result.rowCount)
      return res
        .status(409)
        .json({ error: 'Room or settings changed. Refresh and try again.' });
    res.json({ ok: true });
  })
);
managedRooms.post(
  '/:code/review',
  asyncRoute(async (req, res) => {
    const { id, request, action, reply } = req.body || {};
    if (
      (reply !== undefined && !label(reply, 240)) ||
      !/^[a-f0-9-]{36}$/i.test(id || '') ||
      !['help', 'exit'].includes(request) ||
      !(action === 'resolve' || (request === 'exit' && action === 'release'))
    )
      return res.sendStatus(400);
    const r = await q(
      'UPDATE managed_members SET request=NULL,released=$4,reply=$5 WHERE room=$1 AND id::text=$2 AND request=$3 AND NOT released',
      [
        req.params.code,
        id,
        request,
        action === 'release',
        reply ||
          (request === 'exit'
            ? 'Exit request reviewed.'
            : 'Help request marked resolved.')
      ]
    );
    if (!r.rowCount)
      return res.status(409).json({ error: 'That request has changed.' });
    res.json({ ok: true });
  })
);
managedRooms.post(
  '/:code/end',
  asyncRoute(async (req, res) => {
    await q('UPDATE managed_rooms SET closed=true WHERE code=$1', [
      req.params.code
    ]);
    res.json({ ok: true });
  })
);
