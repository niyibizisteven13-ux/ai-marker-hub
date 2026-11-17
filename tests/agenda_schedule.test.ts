import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, describeSchedule, nextRun, parseTime, validTimeZone, zonedToUtc, type Schedule } from '../server/services/agenda/schedule.js';

// Scheduled tasks run at the user's local time. Kigali has no daylight saving (UTC+2); Europe/Paris and America/New_York do.
const iso = (d: Date | null) => (d ? d.toISOString() : null);

test('times and zones are checked', () => {
  assert.deepEqual(parseTime('07:30'), { h: 7, m: 30 }); assert.deepEqual(parseTime('7:05'), { h: 7, m: 5 }); assert.equal(parseTime('24:00'), null); assert.equal(parseTime('9'), null); assert.equal(parseTime('12:60'), null);
  assert.ok(validTimeZone('Africa/Kigali')); assert.ok(!validTimeZone('Mars/Olympus'));
});

test('a daily task runs at the local time: today if it is still ahead, otherwise tomorrow', () => {
  const s: Schedule = { kind: 'daily', time: '07:00' };
  // 2026-11-16 03:00 UTC = 05:00 in Kigali: 07:00 Kigali (05:00 UTC) is today
  assert.equal(iso(nextRun(s, new Date('2026-11-16T03:00:00Z'), 'Africa/Kigali')), '2026-11-16T05:00:00.000Z');
  // 06:00 UTC = 08:00 Kigali: today's 07:00 has passed, so tomorrow's
  assert.equal(iso(nextRun(s, new Date('2026-11-16T06:00:00Z'), 'Africa/Kigali')), '2026-11-17T05:00:00.000Z');
  // exactly at the time: the next one, never the same moment again
  assert.equal(iso(nextRun(s, new Date('2026-11-16T05:00:00Z'), 'Africa/Kigali')), '2026-11-17T05:00:00.000Z');
});

test('a weekly task finds the next chosen day, including later this week and across a week', () => {
  const fri: Schedule = { kind: 'weekly', time: '16:00', days: [5] };
  // 2026-11-16 is a Monday; the next Friday is 2026-11-20, 16:00 Kigali = 14:00 UTC
  assert.equal(iso(nextRun(fri, new Date('2026-11-16T09:00:00Z'), 'Africa/Kigali')), '2026-11-20T14:00:00.000Z');
  // on Friday before 16:00 it is today; after 16:00 it is next Friday
  assert.equal(iso(nextRun(fri, new Date('2026-11-20T10:00:00Z'), 'Africa/Kigali')), '2026-11-20T14:00:00.000Z');
  assert.equal(iso(nextRun(fri, new Date('2026-11-20T15:00:00Z'), 'Africa/Kigali')), '2026-11-27T14:00:00.000Z');
  const weekdays: Schedule = { kind: 'weekly', time: '07:00', days: [1, 2, 3, 4, 5] };
  // Friday evening: the next weekday morning is Monday
  assert.equal(iso(nextRun(weekdays, new Date('2026-11-20T20:00:00Z'), 'Africa/Kigali')), '2026-11-23T05:00:00.000Z');
  assert.equal(nextRun({ kind: 'weekly', time: '07:00', days: [] }, new Date(), 'Africa/Kigali'), null);
});

test('the local day, not the UTC day, decides: late evening in Kigali is still "today"', () => {
  // 23:30 UTC on Sunday 2026-11-15 is 01:30 Monday in Kigali: a Monday 07:00 task is later that same morning
  const mon: Schedule = { kind: 'weekly', time: '07:00', days: [1] };
  assert.equal(iso(nextRun(mon, new Date('2026-11-15T23:30:00Z'), 'Africa/Kigali')), '2026-11-16T05:00:00.000Z');
});

test('daylight saving: the local time stays the same while the UTC time moves', () => {
  const s: Schedule = { kind: 'daily', time: '08:00' };
  // Paris is UTC+1 in winter and UTC+2 in summer; clocks went forward on 2026-03-29
  assert.equal(iso(nextRun(s, new Date('2026-03-28T10:00:00Z'), 'Europe/Paris')), '2026-03-29T06:00:00.000Z', '08:00 local is 06:00 UTC after the change (summer time)');
  assert.equal(iso(nextRun(s, new Date('2026-03-27T10:00:00Z'), 'Europe/Paris')), '2026-03-28T07:00:00.000Z', 'and 07:00 UTC the day before (winter time)');
  assert.equal(zonedToUtc(2026, 7, 1, 9, 0, 'America/New_York'), Date.UTC(2026, 6, 1, 13, 0), 'New York summer time is UTC-4');
});

test('a one-time task runs once and then has no next time', () => {
  const s: Schedule = { kind: 'once', at: '2026-12-04T14:00:00.000Z' };
  assert.equal(iso(nextRun(s, new Date('2026-12-01T00:00:00Z'))), '2026-12-04T14:00:00.000Z');
  assert.equal(nextRun(s, new Date('2026-12-04T14:00:00Z')), null); assert.equal(nextRun(s, new Date('2026-12-05T00:00:00Z')), null);
});

test('what the user asked for is checked, and described in plain words', () => {
  const now = new Date('2026-11-16T10:00:00Z');
  const ok = (i: any) => { const r = buildSchedule(i, now); assert.ok(r.ok, JSON.stringify(r)); return (r as any).schedule as Schedule; };
  const bad = (i: any) => { const r = buildSchedule(i, now); assert.ok(!r.ok); return (r as any).error as string; };
  assert.deepEqual(ok({ when: 'daily', time: '7:00' }), { kind: 'daily', time: '07:00' });
  assert.deepEqual(ok({ when: 'weekly', time: '16:00', days: [5, 5, 'x', 9, 1] }), { kind: 'weekly', time: '16:00', days: [5, 1] });
  assert.equal(ok({ when: 'once', at: '2026-12-04T16:00:00+02:00' }).kind, 'once');
  assert.match(bad({ when: 'daily', time: 'morning' }), /HH:MM/); assert.match(bad({ when: 'weekly', time: '16:00' }), /which days/); assert.match(bad({ when: 'once', at: '2026-01-01T00:00:00Z' }), /passed/);
  assert.match(bad({ when: 'once', at: '2099-01-01T00:00:00Z' }), /year/); assert.match(bad({ when: 'yearly', time: '10:00' }), /once, daily or weekly/);
  assert.equal(describeSchedule({ kind: 'daily', time: '07:00' }), 'every day at 07:00');
  assert.equal(describeSchedule({ kind: 'weekly', time: '16:00', days: [5] }), 'every Friday at 16:00');
  assert.equal(describeSchedule({ kind: 'weekly', time: '07:00', days: [1, 2, 3, 4, 5] }), 'every weekday at 07:00');
  assert.equal(describeSchedule({ kind: 'weekly', time: '09:00', days: [6, 0] }), 'every weekend at 09:00');
  assert.match(describeSchedule({ kind: 'once', at: '2026-12-04T14:00:00.000Z' }, 'Africa/Kigali'), /once, on Friday 4\/12\/2026 at 16:00/);
});
