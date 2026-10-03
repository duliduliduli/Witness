// Core domain types for Witness.

export type MatchFormat = 'single' | 'bo3';

/**
 * One reading of the scoreboard produced by a game-specific analyzer.
 * The analyzer turns video frames into these; everything downstream
 * works only with readings, never raw video.
 */
export type FrameReading = {
  /** Capture time of the frame, ms since epoch. */
  t: number;
  /** False when the scoreboard was obscured, missing or not recognised. */
  readable: boolean;
  /** Scores in participant order, when readable. */
  scores?: [number, number];
  /** What the analyzer thinks is on screen. */
  screen?: 'playing' | 'match_end' | 'other';
};

export type EvidenceStatus = 'observed' | 'degraded' | 'insufficient';

export type EventType =
  | 'session.started'
  | 'match.started'
  | 'score.updated'
  | 'match.result_detected'
  | 'evidence.warning'
  | 'session.result_detected'
  | 'session.inconclusive'
  | 'result.recorded'
  | 'result.disputed'
  | 'result.corrected';

export type WitnessEvent = {
  id: string;
  type: EventType;
  sessionId: string;
  /** When Witness emitted the event. */
  emittedAt: number;
  /** Capture time of the evidence the event is based on. */
  observedAt: number;
  /** Increments with every event in a session, so consumers can order and dedupe. */
  version: number;
  evidenceStatus: EvidenceStatus;
  data: Record<string, unknown>;
};

export type MatchResult = {
  index: number;
  scores: [number, number];
  /** Participant index of the winner, or null when it cannot be established. */
  winner: 0 | 1 | null;
  startedAt: number;
  endedAt: number;
  coverage: number;
  warnings: string[];
};

export type EvidenceMethod =
  | 'video-observed'
  | 'participant-confirmed'
  | 'source-corroborated'
  | 'human-reviewed';

/** Lifecycle of a record. Separate from evidence quality on purpose. */
export type RecordStatus =
  | 'provisional'
  | 'recorded'
  | 'disputed'
  | 'corrected'
  | 'inconclusive';

export type EvidenceQuality = 'high' | 'reduced' | 'insufficient';

export type LedgerRef = {
  network: string;
  height: number;
  txHash: string;
};

/** The minimal, public part of a record that is written to the ledger. */
export type OnChainPayload = {
  recordId: string;
  schemaVersion: 1;
  game: string;
  format: MatchFormat;
  participants: [string, string];
  matches: { scores: [number, number]; winner: 0 | 1 | null }[];
  winner: 0 | 1 | null;
  observedFrom: number;
  observedTo: number;
  evidenceFingerprint: string;
  supersedes: string | null;
  issuedAt: number;
};

export type Dispute = {
  id: string;
  by: string;
  reason: string;
  createdAt: number;
};

export type WitnessRecord = {
  id: string;
  sessionId: string;
  status: RecordStatus;
  payload: OnChainPayload;
  signature: string;
  evidence: {
    methods: EvidenceMethod[];
    quality: EvidenceQuality;
    coverage: number;
    warnings: string[];
    confirmedBy: string[];
  };
  ledgerRef: LedgerRef | null;
  publishError: string | null;
  supersededBy: string | null;
  correctionReason: string | null;
  disputes: Dispute[];
  createdAt: number;
};
