'use strict';
/**
 * Strict Windows lock. For the length of the exam MySEB switches on a few Windows policies for the CURRENT USER only (no administrator
 * rights needed, nothing is installed) and puts every one of them back afterwards:
 *   taskmgr  Task Manager can not be opened            (Policies\System  DisableTaskMgr)
 *   lock     Win+L / Ctrl+Alt+Del "Lock" is refused    (Policies\System  DisableLockWorkstation)
 *   winkey   Windows key and its shortcuts are ignored (Policies\Explorer NoWinKeys)
 *   snip     snipping tools are reported if they run   (handled by the caller: a blocked-program list)
 *
 * Honest limits: the Ctrl+Alt+Del screen itself can not be removed without a driver; Windows may apply NoWinKeys only after the
 * shell re-reads its policies, so MySEB also reports any time the exam window loses focus; the student's own administrator
 * account could undo it. That is why MySEB records `lock_unavailable` when a policy can not be set.
 *
 * Everything the caller needs is pure or takes `run(args) -> Promise<{code, out}>` so it is tested without Windows.
 */
const fs = require('node:fs');
const path = require('node:path');

const POLICIES = {
  taskmgr: { key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', name: 'DisableTaskMgr' },
  lock: { key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', name: 'DisableLockWorkstation' },
  winkey: { key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer', name: 'NoWinKeys' },
};
const SNIPPING = ['snippingtool', 'screenclippinghost', 'snipandsketch', 'screensketch', 'greenshot', 'lightshot', 'sharex', 'flameshot'];

/** What the lecturer asked for, as the registry values to set. Unknown names are dropped. */
function plan(level, block) {
  if (level !== 'strict') return [];
  return (Array.isArray(block) ? block : []).filter((b) => POLICIES[b]).map((b) => ({ id: b, ...POLICIES[b] }));
}
/** The extra programs to flag while a strict lock is on and snipping tools are not allowed. */
const extraBlockedPrograms = (level, block) => (level === 'strict' && Array.isArray(block) && block.includes('snip') ? SNIPPING : []);

const parseDword = (out) => { const m = /REG_DWORD\s+0x([0-9a-f]+)/i.exec(String(out)); return m ? parseInt(m[1], 16) : null; };

/** Turn the policies on. Saves what was there before, to a file, first: if MySEB is killed the next start puts it back. */
async function apply(items, run, file) {
  if (!items.length) return { ok: true, applied: [] };
  const before = [];
  for (const it of items) { const r = await run(['query', it.key, '/v', it.name]); before.push({ ...it, was: r.code === 0 ? parseDword(r.out) : null }); }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(before));
  const failed = [];
  for (const it of items) {
    const r = await run(['add', it.key, '/v', it.name, '/t', 'REG_DWORD', '/d', '1', '/f']);
    if (r.code !== 0) failed.push(it.id);
  }
  return { ok: failed.length === 0, applied: items.map((i) => i.id).filter((i) => !failed.includes(i)), failed };
}

/** Put every policy back exactly as it was (deleted if it did not exist) and forget the backup. Safe to call twice. */
async function restore(run, file) {
  let before = [];
  try { before = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { restored: 0 }; }
  let n = 0;
  for (const it of before) {
    if (!POLICIES[it.id]) continue;
    const r = it.was === null ? await run(['delete', it.key, '/v', it.name, '/f']) : await run(['add', it.key, '/v', it.name, '/t', 'REG_DWORD', '/d', String(it.was), '/f']);
    if (r.code === 0 || it.was === null) n++;
  }
  try { fs.unlinkSync(file); } catch { /* already gone */ }
  return { restored: n };
}

module.exports = { plan, apply, restore, extraBlockedPrograms, POLICIES, SNIPPING, parseDword };
