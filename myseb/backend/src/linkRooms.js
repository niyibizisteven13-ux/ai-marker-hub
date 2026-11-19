import express from 'express';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { config, safeEqual } from './config.js';
import { q } from './db.js';
import { newToken, tokenHash, rateLimit } from './security.js';

export const linkRooms = express.Router();
const route = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bearer = req => (req.get('authorization') || '').replace(/^Bearer /i, '');
const limited = rateLimit({ windowMs: 60000, max: 10 });
function httpsUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password ? u : null;
  } catch { return null; }
}
function label(value, max) {
  return typeof value === 'string' && value.trim().length <= max ? value.trim() : '';
}

linkRooms.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
linkRooms.post('/', limited, route(async (req, res) => {
  const { title, mode, sites, activities } = req.body || {};
  if (!label(title, 120) || !['open','selected','single'].includes(mode) ||
      !Array.isArray(sites) || sites.length > 20 || !sites.every(v => httpsUrl(v)) ||
      !Array.isArray(activities) || !activities.length || activities.length > 30 ||
      !activities.every(a => label(a?.title, 120) && httpsUrl(a.url))) {
    return res.status(400).json({ error: 'Use a room name, 1–30 named HTTPS activities and up to 20 approved sites.' });
  }
  const key = newToken();
  const origins = mode === 'selected' ? [...new Set(sites.map(v => httpsUrl(v).origin))] : [];
  const items = activities.map(a => ({ title: a.title.trim(), url: httpsUrl(a.url).href }));
  while (true) {
    const code = 'LR-' + randomBytes(5).toString('hex').toUpperCase();
    const inserted = await q('INSERT INTO link_rooms(code,host_hash,title,mode,sites,activities) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [code, tokenHash(key), title.trim(), mode, JSON.stringify(origins), JSON.stringify(items)]);
    if (inserted.rowCount) return res.status(201).json({ code, key });
  }
}));
linkRooms.param('code', (req, res, next, code) => {
  if (!/^LR-[0-9A-F]{10}$/.test(code)) return res.status(404).json({ error: 'Room unavailable.' });
  q('SELECT * FROM link_rooms WHERE code=$1 AND expires_at>now()', [code]).then(r => {
    if (!r.rowCount) return res.status(404).json({ error: 'Room ended or code incorrect.' });
    req.room = r.rows[0]; next();
  }, next);
});
linkRooms.post('/:code/join', rateLimit({ windowMs: 60000, max: 600 }), route(async (req, res) => {
  const name = label(req.body?.name, 80);
  if (!name) return res.status(400).json({ error: 'Enter your name.' });
  const key = newToken();
  await q('INSERT INTO link_room_members(room,member_hash,name) VALUES($1,$2,$3)', [req.room.code, tokenHash(key), name]);
  res.status(201).json({ key });
}));
linkRooms.use('/:code', route(async (req, res, next) => {
  const hash = tokenHash(bearer(req));
  req.isRoomHost = safeEqual(req.room.host_hash, hash);
  if (!req.isRoomHost && !(await q('SELECT 1 FROM link_room_members WHERE room=$1 AND member_hash=$2', [req.room.code, hash])).rowCount)
    return res.status(403).json({ error: 'Join the room first.' });
  next();
}));
linkRooms.get('/:code', route(async (req, res) => {
  const {code,title,mode,sites,active,activities} = req.room;
  const state = {title,mode,sites,active,activity: activities[active] ?? null};
  if (req.isRoomHost) {
    state.activities = activities;
    state.members = (await q('SELECT name, opened FROM link_room_members WHERE room=$1 ORDER BY name', [code])).rows;
  }
  res.json(state);
}));
linkRooms.get('/:code/qr', route(async (req, res) => {
  res.type('png').send(await QRCode.toBuffer(config.publicUrl + '/liveroom/?room=' + req.room.code));
}));
linkRooms.post('/:code/release', route(async (req, res) => {
  if (!req.isRoomHost) return res.sendStatus(403);
  const i = req.body?.index;
  if (!Number.isInteger(i) || !req.room.activities[i]) return res.status(400).json({error:'Choose an activity.'});
  await q('UPDATE link_rooms SET active=$2 WHERE code=$1', [req.room.code, i]); res.json({ok:true});
}));
linkRooms.post('/:code/opened', route(async (req, res) => {
  const i = req.body?.index;
  if (!Number.isInteger(i) || i !== req.room.active) return res.status(409).json({error:'The host changed the activity.'});
  await q('UPDATE link_room_members SET opened=$3 WHERE room=$1 AND member_hash=$2', [req.room.code, tokenHash(bearer(req)), i]); res.json({ok:true});
}));
linkRooms.delete('/:code', route(async (req, res) => {
  if (!req.isRoomHost) return res.sendStatus(403);
  await q('DELETE FROM link_rooms WHERE code=$1', [req.room.code]); res.json({ok:true});
}));
