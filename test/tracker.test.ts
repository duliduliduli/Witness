import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchTracker } from '../src/tracker.ts';
import { sampleSeries, simulate } from '../src/simulator.ts';
import type { EventType, FrameReading } from '../src/types.ts';

function run(format: 'single' | 'bo3', readings: FrameReading[]) {
  const events: { type: EventType; data: Record<string, unknown> }[] = [];
  const t = new MatchTracker(format, (type, _at, _s, data) => events.push({ type, data }));
  for (const r of readings) t.process(r);
  return { t, events, types: events.map((e) => e.type) };
}

test('clean best-of-three is decided correctly', () => {
  const { t } = run('bo3', simulate(sampleSeries(), { start: 0 }));
  const s = t.summary();
  assert.equal(s.conclusive, true);
  assert.equal(s.winner, 0);
  assert.deepEqual(s.wins, [2, 1]);
  assert.deepEqual(s.matches.map((m) => m.scores), [[4, 2], [1, 4], [4, 2]]);
  assert.ok(s.matches.every((m) => m.warnings.length === 0));
});

test('noisy footage with misreads still yields the right result across many seeds', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const { t } = run('bo3', simulate(sampleSeries(), { start: 0, seed, dropRate: 0.05, misreadRate: 0.05 }));
    const s = t.summary();
    assert.equal(s.winner, 0, `seed ${seed}`);
    assert.deepEqual(s.matches.map((m) => m.scores), [[4, 2], [1, 4], [4, 2]], `seed ${seed}`);
  }
});

test('single misread frames never become score events', () => {
  const r: FrameReading[] = [];
  let t = 0;
  for (let i = 0; i < 5; i++) r.push({ t: (t += 500), readable: true, scores: [0, 0], screen: 'playing' });
  r.push({ t: (t += 500), readable: true, scores: [7, 7], screen: 'playing' });
  for (let i = 0; i < 5; i++) r.push({ t: (t += 500), readable: true, scores: [0, 0], screen: 'playing' });
  const { types } = run('single', r);
  assert.ok(!types.includes('score.updated'));
});

test('long blackout is reported as a gap and degrades the match', () => {
  const { t, events } = run('single', simulate([{ points: [0, 0, 1, 0, 0] }], { start: 0, blackout: 20 }));
  const s = t.summary();
  assert.equal(s.winner, 0);
  assert.ok(s.matches[0].warnings.some((w) => w.includes('No readable footage')));
  assert.ok(events.some((e) => e.type === 'evidence.warning' && String(e.data.message).includes('unreadable')));
});

test('mostly unreadable match refuses to name a winner', () => {
  const { t, types } = run('single', simulate([{ points: [0, 1, 0, 0] }], { start: 0, blackout: 200 }));
  const s = t.summary();
  assert.equal(s.matches[0].winner, null);
  assert.equal(s.conclusive, false);
  assert.ok(types.includes('session.inconclusive'));
});

test('stream ending mid-series is inconclusive, not a guess', () => {
  const all = simulate(sampleSeries(), { start: 0 });
  const { t } = run('bo3', all.slice(0, Math.floor(all.length * 0.5)));
  const s = t.finish(1e9, 'Stream ended');
  assert.equal(s.conclusive, false);
  assert.equal(s.winner, null);
  assert.match(s.reason!, /Stream ended/);
});

test('joining mid-match and score regressions are flagged', () => {
  const r: FrameReading[] = [];
  let t = 0;
  const add = (scores: [number, number], screen: FrameReading['screen'] = 'playing') => {
    for (let i = 0; i < 4; i++) r.push({ t: (t += 500), readable: true, scores, screen });
  };
  add([2, 1]);
  add([3, 1]);
  add([2, 1]);
  add([4, 1], 'match_end');
  const { t: tr } = run('single', r);
  const w = tr.summary().matches[0].warnings.join(' ');
  assert.match(w, /began after the match had started/);
  assert.match(w, /Score went backwards/);
  assert.match(w, /Final screen shows 4–1/);
});

test('out-of-order frames are ignored', () => {
  const { t, types } = run('single', [
    { t: 1000, readable: true, scores: [0, 0] },
    { t: 1500, readable: true, scores: [0, 0] },
    { t: 2000, readable: true, scores: [0, 0] },
    { t: 100, readable: true, scores: [9, 9] },
    { t: 101, readable: true, scores: [9, 9] },
    { t: 102, readable: true, scores: [9, 9] },
  ]);
  assert.deepEqual(t.liveScores, [0, 0]);
  assert.ok(!types.includes('score.updated'));
});
