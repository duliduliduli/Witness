import type { FrameReading } from './types.ts';

/**
 * Stand-in for a game-specific video analyzer: produces the scoreboard
 * readings an analyzer would emit, including the noise real footage has
 * (single-frame misreads and unreadable stretches).
 */
export type SimMatch = {
  /** Who scores each point, in order: 0 or 1. */
  points: (0 | 1)[];
};

export type SimOptions = {
  start?: number;
  /** Time between readings, ms. */
  frameMs?: number;
  /** Readings between points. */
  framesPerPoint?: number;
  /** Probability a frame is unreadable. */
  dropRate?: number;
  /** Probability a frame is misread as a random score. */
  misreadRate?: number;
  /** Deterministic randomness for tests. */
  seed?: number;
  /** Insert one unreadable stretch of this many frames in the first match. */
  blackout?: number;
};

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulate(matches: SimMatch[], o: SimOptions = {}): FrameReading[] {
  const frameMs = o.frameMs ?? 500;
  const per = o.framesPerPoint ?? 8;
  const rand = rng(o.seed ?? 1);
  const out: FrameReading[] = [];
  let t = o.start ?? Date.now();

  const frame = (scores: [number, number], screen: FrameReading['screen'], clean = false) => {
    t += frameMs;
    const roll = rand();
    if (!clean && roll < (o.dropRate ?? 0)) {
      out.push({ t, readable: false });
    } else if (!clean && roll < (o.dropRate ?? 0) + (o.misreadRate ?? 0)) {
      out.push({ t, readable: true, scores: [Math.floor(rand() * 9), Math.floor(rand() * 9)], screen });
    } else {
      out.push({ t, readable: true, scores: [...scores], screen });
    }
  };

  matches.forEach((m, mi) => {
    const s: [number, number] = [0, 0];
    for (let i = 0; i < per; i++) frame(s, 'playing', i < 4);
    m.points.forEach((p, pi) => {
      s[p]++;
      for (let i = 0; i < per; i++) frame(s, 'playing');
      if (mi === 0 && pi === 1 && o.blackout) {
        for (let i = 0; i < o.blackout; i++) {
          t += frameMs;
          out.push({ t, readable: false });
        }
      }
    });
    for (let i = 0; i < per; i++) frame(s, 'match_end', true);
    for (let i = 0; i < 4; i++) {
      t += frameMs;
      out.push({ t, readable: true, screen: 'other', scores: [0, 0] });
    }
  });
  return out;
}

/** A best-of-three where player 0 wins 2–1. */
export function sampleSeries(): SimMatch[] {
  return [
    { points: [0, 1, 0, 0, 1, 0] }, // 4–2
    { points: [1, 1, 0, 1, 1] }, // 1–4
    { points: [0, 0, 1, 0, 1, 0] }, // 4–2
  ];
}
