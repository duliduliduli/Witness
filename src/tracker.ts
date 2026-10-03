import type { EventType, EvidenceStatus, FrameReading, MatchFormat, MatchResult } from './types.ts';

export type TrackerOptions = {
  /** Identical consecutive readings needed before a change is accepted. */
  confirmFrames: number;
  /** A gap between readable frames longer than this is reported. */
  gapMs: number;
  /** Below this share of readable frames, a match result is flagged as reduced quality. */
  minCoverage: number;
  /** Below this share of readable frames, Witness refuses to name a winner. */
  insufficientCoverage: number;
};

export const defaultTrackerOptions: TrackerOptions = {
  confirmFrames: 3,
  gapMs: 5000,
  minCoverage: 0.8,
  insufficientCoverage: 0.5,
};

export type TrackerEmit = (
  type: EventType,
  observedAt: number,
  evidenceStatus: EvidenceStatus,
  data: Record<string, unknown>,
) => void;

type CurrentMatch = {
  index: number;
  startedAt: number;
  scores: [number, number];
  readable: number;
  total: number;
  warnings: string[];
};

type Phase = 'waiting' | 'playing' | 'between' | 'done';

export type TrackerSummary = {
  matches: MatchResult[];
  wins: [number, number];
  winner: 0 | 1 | null;
  conclusive: boolean;
  reason: string | null;
};

/**
 * Combines scoreboard readings into a consistent match timeline.
 * It never invents a result: unreadable stretches, contradictions and
 * low coverage are surfaced as warnings or an inconclusive outcome.
 */
export class MatchTracker {
  readonly format: MatchFormat;
  readonly opts: TrackerOptions;
  private emit: TrackerEmit;
  private phase: Phase = 'waiting';
  private current: CurrentMatch | null = null;
  private matches: MatchResult[] = [];
  private wins: [number, number] = [0, 0];
  private candidate: { key: string; count: number; reading: FrameReading } | null = null;
  private lastReadableAt: number | null = null;
  private unreadableStreak = 0;
  private inconclusiveReason: string | null = null;
  private lastT = 0;

  constructor(format: MatchFormat, emit: TrackerEmit, opts: Partial<TrackerOptions> = {}) {
    this.format = format;
    this.emit = emit;
    this.opts = { ...defaultTrackerOptions, ...opts };
  }

  get isDone(): boolean {
    return this.phase === 'done';
  }

  get liveScores(): [number, number] | null {
    return this.current ? [...this.current.scores] : null;
  }

  process(r: FrameReading): void {
    if (this.phase === 'done') return;
    if (r.t < this.lastT) return; // out-of-order frame; ignore rather than rewrite history
    this.lastT = r.t;
    if (this.current) this.current.total++;

    if (!r.readable || !r.scores) {
      this.unreadableStreak++;
      this.candidate = null;
      if (this.unreadableStreak === this.opts.confirmFrames && this.current) {
        this.warn(r.t, 'Scoreboard is unreadable; results during this stretch are not observed.');
      }
      return;
    }

    if (this.unreadableStreak >= this.opts.confirmFrames && this.current) {
      this.emit('evidence.warning', r.t, this.status(), { message: 'Scoreboard readable again.' });
    }
    this.unreadableStreak = 0;
    if (this.current && this.lastReadableAt !== null && r.t - this.lastReadableAt > this.opts.gapMs) {
      const secs = Math.round((r.t - this.lastReadableAt) / 1000);
      this.warn(r.t, `No readable footage for ${secs}s.`);
    }
    this.lastReadableAt = r.t;
    if (this.current) this.current.readable++;

    const key = `${r.screen ?? 'playing'}:${r.scores[0]}-${r.scores[1]}`;
    if (this.candidate?.key === key) this.candidate.count++;
    else this.candidate = { key, count: 1, reading: r };
    // Apply exactly once, when a reading has been seen enough times in a row.
    if (this.candidate.count === this.opts.confirmFrames) this.apply(this.candidate.reading, r.t);
  }

  /** Call when the source ends or the user stops observing. */
  finish(at: number, why = 'Observation ended'): TrackerSummary {
    if (this.phase !== 'done') {
      this.inconclusiveReason = this.current
        ? `${why} while match ${this.current.index + 1} was in progress.`
        : `${why} before the ${this.format === 'bo3' ? 'series' : 'match'} was decided.`;
      this.phase = 'done';
      this.emit('session.inconclusive', at, 'insufficient', { reason: this.inconclusiveReason });
    }
    return this.summary();
  }

  summary(): TrackerSummary {
    const needed = this.format === 'bo3' ? 2 : 1;
    const winner = this.wins[0] >= needed ? 0 : this.wins[1] >= needed ? 1 : null;
    return {
      matches: this.matches.map((m) => ({ ...m, scores: [...m.scores], warnings: [...m.warnings] })),
      wins: [...this.wins],
      winner,
      conclusive: winner !== null && this.inconclusiveReason === null,
      reason: this.inconclusiveReason,
    };
  }

  private apply(r: FrameReading, at: number): void {
    const scores = r.scores!;
    const screen = r.screen ?? 'playing';
    if (screen === 'other') return;

    if (this.phase === 'waiting' || this.phase === 'between') {
      if (screen !== 'playing') return; // stale end screen from the previous match
      this.current = {
        index: this.matches.length,
        startedAt: r.t,
        scores: [...scores],
        readable: this.opts.confirmFrames,
        total: this.opts.confirmFrames,
        warnings: [],
      };
      this.phase = 'playing';
      this.emit('match.started', r.t, 'observed', { match: this.current.index + 1, scores });
      if (scores[0] !== 0 || scores[1] !== 0) {
        this.warn(r.t, 'Observation began after the match had started.');
      }
      return;
    }

    const cur = this.current!;
    if (screen === 'match_end') {
      this.endMatch(scores, at);
      return;
    }

    if (scores[0] === cur.scores[0] && scores[1] === cur.scores[1]) return;
    if (scores[0] < cur.scores[0] || scores[1] < cur.scores[1]) {
      this.warn(r.t, `Score went backwards (${cur.scores.join('–')} → ${scores.join('–')}).`);
    }
    const previous = cur.scores;
    cur.scores = [...scores];
    this.emit('score.updated', r.t, this.status(), { match: cur.index + 1, scores, previous });
  }

  private endMatch(scores: [number, number], at: number): void {
    const cur = this.current!;
    if (scores[0] !== cur.scores[0] || scores[1] !== cur.scores[1]) {
      cur.warnings.push(`Final screen shows ${scores.join('–')}; last observed live score was ${cur.scores.join('–')}.`);
    }
    const coverage = cur.total ? cur.readable / cur.total : 0;
    if (coverage < this.opts.minCoverage) {
      cur.warnings.push(`Only ${Math.round(coverage * 100)}% of the match was readable.`);
    }
    let winner: 0 | 1 | null = scores[0] > scores[1] ? 0 : scores[1] > scores[0] ? 1 : null;
    if (coverage < this.opts.insufficientCoverage) winner = null;

    const result: MatchResult = {
      index: cur.index,
      scores: [...scores],
      winner,
      startedAt: cur.startedAt,
      endedAt: at,
      coverage: Math.round(coverage * 1000) / 1000,
      warnings: cur.warnings,
    };
    this.matches.push(result);
    this.current = null;
    const status: EvidenceStatus = winner === null ? 'insufficient' : result.warnings.length ? 'degraded' : 'observed';
    this.emit('match.result_detected', at, status, { match: result.index + 1, scores, winner, coverage: result.coverage });

    if (winner !== null) this.wins[winner]++;
    const needed = this.format === 'bo3' ? 2 : 1;
    if (this.wins[0] >= needed || this.wins[1] >= needed) {
      this.phase = 'done';
      const s = this.summary();
      this.emit('session.result_detected', at, this.matches.some((m) => m.warnings.length) ? 'degraded' : 'observed', {
        wins: s.wins,
        winner: s.winner,
      });
    } else if (this.format === 'single') {
      // A single match with no clear winner cannot be decided by more play.
      this.phase = 'done';
      this.inconclusiveReason = 'The match result could not be established from the footage.';
      this.emit('session.inconclusive', at, 'insufficient', { reason: this.inconclusiveReason });
    } else {
      this.phase = 'between';
    }
  }

  private warn(t: number, message: string): void {
    this.current?.warnings.push(message);
    this.emit('evidence.warning', t, 'degraded', { message });
  }

  private status(): EvidenceStatus {
    return this.current?.warnings.length ? 'degraded' : 'observed';
  }
}
