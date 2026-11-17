// CI gate: fails on high or critical vulnerabilities in production dependencies, except advisories listed (with a reason and an expiry date)
// in .audit-allow.json. An expired allowance stops counting, so it cannot be forgotten. Usage: node scripts/audit-gate.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const allowFile = new URL('../.audit-allow.json', import.meta.url);
const allow = existsSync(allowFile) ? JSON.parse(readFileSync(allowFile, 'utf8')) : [];
const today = new Date().toISOString().slice(0, 10);
const active = new Map(allow.filter((a) => a.expires >= today).map((a) => [a.advisory, a]));
for (const a of allow) if (a.expires < today) console.log(`NOTE: the allowance for ${a.advisory} expired on ${a.expires}; it no longer applies.`);

let out;
try { out = execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
catch (e) { out = e.stdout?.toString() ?? ''; }
const report = JSON.parse(out || '{}'); const vulns = report.vulnerabilities ?? {};

/** The advisories a vulnerable package is vulnerable because of (following "via" through other packages). */
function advisories(name, seen = new Set()) {
  if (seen.has(name)) return []; seen.add(name); const v = vulns[name]; if (!v) return [];
  return v.via.flatMap((x) => (typeof x === 'string' ? advisories(x, seen) : [x.url]));
}
const failing = [];
for (const [name, v] of Object.entries(vulns)) {
  if (v.severity !== 'high' && v.severity !== 'critical') continue;
  const ids = advisories(name); const open = ids.filter((u) => !active.has(u));
  if (open.length || !ids.length) failing.push(`${name} (${v.severity}): ${[...new Set(open)].join(', ') || 'no advisory detail'}`);
}
for (const [u, a] of active) console.log(`Allowed until ${a.expires}: ${u} (${a.reason})`);
if (failing.length) { console.error(`High or critical vulnerabilities in production dependencies:\n- ${failing.join('\n- ')}`); process.exit(1); }
console.log('No high or critical vulnerabilities in production dependencies (apart from the listed allowances).');
