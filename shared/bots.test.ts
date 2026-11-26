import { describe, expect, it } from 'vitest';
import { type BotRun, type BotSchedule, dueTime, holdsWords, nextTime, parseSchedule, reportsOf, runName, scheduleWords, unreadReports } from './bots.ts';

/** A local time, so the tests hold in any time zone. 2026-11-23 is a Monday. */
const at = (day: number, hh: number, mm = 0, month = 10) => new Date(2026, month, day, hh, mm).getTime();
const MONDAYS: BotSchedule = { days: ['mon'], time: '07:30' };
const WEEKDAYS: BotSchedule = { days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '07:30' };

const run = (over: Partial<BotRun>): BotRun => ({
  id: 'r1', botId: 'b1', botName: 'Team week', name: 'Team week · Nov 23', dueAt: null, startedAt: 0, lateMs: 0, state: 'finished', sessionId: 's1', harness: 'claude',
  waitingFor: null, endedAt: 1, failure: null, session: 'ended', arrivedAt: 1, title: 'Team week', holds: null, read: false, archived: false, launchId: null, ...over,
});

describe('a Bot schedule', () => {
  it('BOT-3.1: a schedule reads in words', () => {
    expect(scheduleWords(null)).toBe('Only by hand');
    expect(scheduleWords({ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], time: '07:30' })).toBe('Every day at 07:30');
    expect(scheduleWords(WEEKDAYS)).toBe('Weekdays at 07:30');
    expect(scheduleWords(MONDAYS)).toBe('Mondays at 07:30');
    expect(scheduleWords({ days: ['wed', 'mon'], time: '18:05' })).toBe('Mon, Wed at 18:05');
  });

  it('BOT-3.1: a schedule is days and a time to the minute, or nothing; anything else is refused with why', () => {
    expect(parseSchedule(null)).toEqual({ ok: true, schedule: null });
    expect(parseSchedule({ days: ['wed', 'mon', 'mon'], time: '07:30' })).toEqual({ ok: true, schedule: { days: ['mon', 'wed'], time: '07:30' } });
    expect(parseSchedule({ days: [], time: '07:30' })).toEqual({ ok: false, error: 'Pick at least one day.' });
    expect(parseSchedule({ days: ['monday'], time: '07:30' })).toMatchObject({ ok: false });
    expect(parseSchedule({ days: ['mon'], time: '7:30' })).toMatchObject({ ok: false });
    expect(parseSchedule({ days: ['mon'], time: '24:00' })).toMatchObject({ ok: false });
    expect(parseSchedule('mon 07:30')).toMatchObject({ ok: false });
  });

  it('BOT-3.2: a time is due from its minute on, and not before', () => {
    expect(dueTime(MONDAYS, at(22, 0), at(23, 7, 29))).toBeNull();
    expect(dueTime(MONDAYS, at(22, 0), at(23, 7, 30))).toBe(at(23, 7, 30));
    expect(dueTime(MONDAYS, at(22, 0), at(23, 7, 31))).toBe(at(23, 7, 30));
    expect(dueTime(null, 0, at(23, 7, 30))).toBeNull();
  });

  it('BOT-3.3: times missed while Lookout was away are one late time, the latest', () => {
    // Off since Friday evening, back on Wednesday: Monday's, Tuesday's and Wednesday's passed.
    expect(dueTime(WEEKDAYS, at(20, 18), at(25, 9))).toBe(at(25, 7, 30));
    // A weekly one found two days late.
    expect(dueTime(MONDAYS, at(16, 8), at(25, 9))).toBe(at(23, 7, 30));
  });

  it('BOT-3.4: a time at or before the floor is never due', () => {
    // Made on Monday at 08:00: that morning's 07:30 already passed.
    expect(dueTime(MONDAYS, at(23, 8), at(23, 9))).toBeNull();
    // Its last scheduled run was this very time.
    expect(dueTime(MONDAYS, at(23, 7, 30), at(23, 12))).toBeNull();
    expect(dueTime(MONDAYS, at(23, 7, 30), at(30, 7, 30))).toBe(at(30, 7, 30));
  });

  it('BOT-3.6: the next time is the first one after now', () => {
    expect(nextTime(MONDAYS, at(23, 7, 29))).toBe(at(23, 7, 30));
    expect(nextTime(MONDAYS, at(23, 7, 30))).toBe(at(30, 7, 30));
    expect(nextTime(WEEKDAYS, at(27, 12))).toBe(at(30, 7, 30));
    expect(nextTime(null, at(23, 7))).toBeNull();
  });

  it('BOT-3.1: a daylight-saving change moves nothing', () => {
    // 2026-03-29, Europe's clocks go forward; 2026-03-08, America's. Whatever the zone, the next
    // day's 07:30 is 07:30 on the wall.
    for (const day of [8, 29]) {
      const next = nextTime({ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], time: '07:30' }, new Date(2026, 2, day, 12).getTime())!;
      expect([new Date(next).getDate(), new Date(next).getHours(), new Date(next).getMinutes()]).toEqual([day + 1, 7, 30]);
    }
  });

  it('BOT-4.1: a run is named after its Bot and the day', () => {
    expect(runName('Team week', at(23, 7, 30))).toBe('Team week · Nov 23');
  });
});

describe('Reports', () => {
  it('INBOX-1.1: the Reports are the runs that arrived, newest arrival first', () => {
    const runs = [run({ id: 'a', arrivedAt: 10 }), run({ id: 'b', arrivedAt: null, state: 'running' }), run({ id: 'c', arrivedAt: 30 }), run({ id: 'd', arrivedAt: 20, archived: true })];
    expect(reportsOf(runs, false).map((r) => r.id)).toEqual(['c', 'a']);
    expect(reportsOf(runs, true).map((r) => r.id)).toEqual(['d']);
  });

  it('INBOX-3.3: the count is the unread Reports that aren’t archived', () => {
    expect(unreadReports([run({}), run({ read: true }), run({ archived: true }), run({ arrivedAt: null, state: 'running' })])).toBe(1);
  });

  it('INBOX-1.2: what a Report holds, in words', () => {
    expect(holdsWords(run({ holds: { documents: 2, reply: true, first: { kind: 'file', type: 'html' } } }))).toBe('2 documents');
    expect(holdsWords(run({ holds: { documents: 1, reply: false, first: { kind: 'artifact', type: null } } }))).toBe('1 document');
    expect(holdsWords(run({ holds: { documents: 0, reply: true, first: null } }))).toBe('a reply');
    expect(holdsWords(run({ state: 'failed', holds: null }))).toBe('failed');
    expect(holdsWords(run({ state: 'waiting', holds: null }))).toBe('waiting on you');
    expect(holdsWords(run({ state: 'running', holds: null }))).toBe('running');
  });
});
