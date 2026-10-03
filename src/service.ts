import { createHmac, randomBytes } from 'node:crypto';
import { canonicalJson, fingerprintEvidence, Issuer, newSalt, sha256, verifySignature } from './crypto.ts';
import type { Publisher } from './ledger.ts';
import { MatchTracker } from './tracker.ts';
import type { TrackerOptions, TrackerSummary } from './tracker.ts';
import type {
  EventType,
  EvidenceMethod,
  EvidenceQuality,
  EvidenceStatus,
  FrameReading,
  MatchFormat,
  OnChainPayload,
  WitnessEvent,
  WitnessRecord,
} from './types.ts';

export class WitnessError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Games with a working analyzer. Only games that pass the technical and rights review get added. */
export const SUPPORTED_GAMES: Record<string, { name: string; maxReadingsPerRequest: number }> = {
  'generic-scoreboard': { name: 'Generic two-player scoreboard (development)', maxReadingsPerRequest: 1000 },
};

export type SessionStatus = 'watching' | 'result_detected' | 'inconclusive';

export type Session = {
  id: string;
  game: string;
  format: MatchFormat;
  participants: [string, string];
  source: { kind: 'push' | 'simulated' };
  /** What the user asked Witness to watch for. Private context, never published. */
  instructions: string;
  status: SessionStatus;
  createdAt: number;
  autoPublish: boolean;
  events: WitnessEvent[];
  recordId: string | null;
  summary: TrackerSummary | null;
};

type SessionInternal = Session & { tracker: MatchTracker; readings: FrameReading[]; version: number };

type Evidence = { salt: string; bundle: unknown };

type Webhook = { id: string; url: string; secret: string; events: EventType[] | null };

export type CreateSessionInput = {
  game?: unknown;
  format?: unknown;
  participants?: unknown;
  acknowledgePublic?: unknown;
  source?: unknown;
  autoPublish?: unknown;
  instructions?: unknown;
};

export type WitnessOptions = {
  publisher: Publisher;
  issuer?: Issuer;
  tracker?: Partial<TrackerOptions>;
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  publishRetries?: number;
};

const ALIAS_RE = /^[\p{L}\p{N} _.\-]{1,32}$/u;

function id(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

function validateAlias(a: unknown): string {
  if (typeof a !== 'string' || !ALIAS_RE.test(a.trim())) {
    throw new WitnessError(400, 'Aliases must be 1–32 letters, numbers, spaces, dots, dashes or underscores.');
  }
  const alias = a.trim();
  // Aliases go on a public, permanent record: refuse things that look like contact details.
  if (/\d{7,}/.test(alias.replace(/[\s.\-]/g, ''))) {
    throw new WitnessError(400, 'Aliases cannot contain phone numbers or other long numbers.');
  }
  return alias;
}

export class Witness {
  readonly issuer: Issuer;
  private publisher: Publisher;
  private trackerOpts: Partial<TrackerOptions>;
  private sessions = new Map<string, SessionInternal>();
  private records = new Map<string, WitnessRecord>();
  private evidence = new Map<string, Evidence>();
  private webhooks = new Map<string, Webhook>();
  private listeners = new Map<string, Set<(e: WitnessEvent) => void>>();
  private fetchImpl: typeof fetch;
  private publishRetries: number;
  /** Outstanding webhook deliveries, so tests and shutdown can wait for them. */
  readonly pending = new Set<Promise<void>>();

  constructor(opts: WitnessOptions) {
    this.publisher = opts.publisher;
    this.issuer = opts.issuer ?? new Issuer();
    this.trackerOpts = opts.tracker ?? {};
    this.fetchImpl = opts.fetch ?? fetch;
    this.publishRetries = opts.publishRetries ?? 3;
  }

  // ---------- sessions ----------

  createSession(input: CreateSessionInput): Session {
    const game = typeof input.game === 'string' ? input.game : '';
    if (!SUPPORTED_GAMES[game]) {
      throw new WitnessError(400, `Unsupported game. Supported: ${Object.keys(SUPPORTED_GAMES).join(', ')}`);
    }
    const format = input.format ?? 'single';
    if (format !== 'single' && format !== 'bo3') throw new WitnessError(400, 'format must be "single" or "bo3".');
    if (!Array.isArray(input.participants) || input.participants.length !== 2) {
      throw new WitnessError(400, 'Exactly two participant aliases are required.');
    }
    const participants = input.participants.map(validateAlias) as [string, string];
    if (participants[0].toLowerCase() === participants[1].toLowerCase()) {
      throw new WitnessError(400, 'Participant aliases must be different.');
    }
    if (input.acknowledgePublic !== true) {
      throw new WitnessError(
        400,
        'You must acknowledge that the final result (aliases, scores, winner, timestamps) will be published permanently and cannot be deleted.',
      );
    }
    const sourceKind = (input.source as { kind?: unknown } | undefined)?.kind ?? 'push';
    if (sourceKind !== 'push' && sourceKind !== 'simulated') {
      throw new WitnessError(400, 'source.kind must be "push" or "simulated".');
    }

    const instructions = typeof input.instructions === 'string' ? input.instructions.trim() : '';
    if (instructions.length > 200) throw new WitnessError(400, 'Keep instructions under 200 characters.');

    const sessionId = id('ses');
    const s: SessionInternal = {
      id: sessionId,
      game,
      format,
      participants,
      source: { kind: sourceKind },
      instructions,
      status: 'watching',
      createdAt: Date.now(),
      autoPublish: input.autoPublish === true,
      events: [],
      recordId: null,
      summary: null,
      readings: [],
      version: 0,
      tracker: undefined as unknown as MatchTracker,
    };
    s.tracker = new MatchTracker(format, (type, observedAt, status, data) => this.emit(s, type, observedAt, status, data), this.trackerOpts);
    this.sessions.set(sessionId, s);
    this.emit(s, 'session.started', s.createdAt, 'observed', { game, format, participants });
    return this.publicSession(s);
  }

  getSession(sessionId: string): Session {
    return this.publicSession(this.mustSession(sessionId));
  }

  liveState(sessionId: string): { scores: [number, number] | null; summary: TrackerSummary } {
    const s = this.mustSession(sessionId);
    return { scores: s.tracker.liveScores, summary: s.tracker.summary() };
  }

  async ingest(sessionId: string, readings: unknown): Promise<Session> {
    const s = this.mustSession(sessionId);
    if (s.status !== 'watching') throw new WitnessError(409, `Session is ${s.status}; it no longer accepts readings.`);
    if (!Array.isArray(readings)) throw new WitnessError(400, 'readings must be an array.');
    if (readings.length > SUPPORTED_GAMES[s.game].maxReadingsPerRequest) throw new WitnessError(413, 'Too many readings in one request.');
    for (const raw of readings) {
      const r = parseReading(raw);
      s.readings.push(r);
      s.tracker.process(r);
      if (s.tracker.isDone) break;
    }
    if (s.tracker.isDone) await this.conclude(s, s.readings.at(-1)?.t ?? Date.now());
    return this.publicSession(s);
  }

  async stop(sessionId: string, why = 'Observation stopped by the user'): Promise<Session> {
    const s = this.mustSession(sessionId);
    if (s.status === 'watching') {
      const at = s.readings.at(-1)?.t ?? Date.now();
      s.tracker.finish(at, why);
      await this.conclude(s, at);
    }
    return this.publicSession(s);
  }

  private async conclude(s: SessionInternal, at: number): Promise<void> {
    const summary = s.tracker.summary();
    s.summary = summary;
    if (!summary.conclusive) {
      s.status = 'inconclusive';
      return;
    }
    s.status = 'result_detected';
    const rec = this.createRecord(s, summary, at);
    if (s.autoPublish && rec.evidence.quality === 'high') {
      await this.publish(rec.id).catch(() => {
        /* stays provisional with publishError set; can be retried */
      });
    }
  }

  // ---------- records ----------

  private createRecord(s: SessionInternal, summary: TrackerSummary, at: number): WitnessRecord {
    const recordId = id('rec');
    const coverage = summary.matches.length
      ? Math.round((summary.matches.reduce((n, m) => n + m.coverage, 0) / summary.matches.length) * 1000) / 1000
      : 0;
    const warnings = summary.matches.flatMap((m) => m.warnings.map((w) => `Match ${m.index + 1}: ${w}`));
    const quality: EvidenceQuality = summary.matches.some((m) => m.winner === null)
      ? 'reduced'
      : warnings.length
        ? 'reduced'
        : 'high';

    // Off-chain evidence bundle. Only its salted fingerprint is published.
    const salt = newSalt();
    const bundle = {
      sessionId: s.id,
      readingsDigest: sha256(canonicalJson(s.readings)),
      readingCount: s.readings.length,
      timeline: s.events.map(({ id: eventId, type, observedAt, data }) => ({ id: eventId, type, observedAt, data })),
      matches: summary.matches,
    };
    this.evidence.set(recordId, { salt, bundle });

    const payload: OnChainPayload = {
      recordId,
      schemaVersion: 1,
      game: s.game,
      format: s.format,
      participants: s.participants,
      matches: summary.matches.map((m) => ({ scores: m.scores, winner: m.winner })),
      winner: summary.winner,
      observedFrom: s.readings[0]?.t ?? s.createdAt,
      observedTo: at,
      evidenceFingerprint: fingerprintEvidence(bundle, salt),
      supersedes: null,
      issuedAt: Date.now(),
    };
    const rec: WitnessRecord = {
      id: recordId,
      sessionId: s.id,
      status: 'provisional',
      payload,
      signature: this.issuer.sign(payload),
      evidence: { methods: ['video-observed'], quality, coverage, warnings, confirmedBy: [] },
      ledgerRef: null,
      publishError: null,
      supersededBy: null,
      correctionReason: null,
      disputes: [],
      createdAt: Date.now(),
    };
    this.records.set(recordId, rec);
    s.recordId = recordId;
    return rec;
  }

  /** Latest published version of each record, newest first. */
  listRecords(limit = 20): WitnessRecord[] {
    return [...this.records.values()]
      .filter((r) => r.ledgerRef && !r.supersededBy)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((r) => structuredClone(r));
  }

  recentSessions(limit = 5): Session[] {
    return [...this.sessions.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((s) => this.publicSession(s));
  }

  getRecord(recordId: string): WitnessRecord {
    const r = this.records.get(recordId);
    if (!r) throw new WitnessError(404, 'Record not found.');
    return structuredClone(r);
  }

  /** The record plus every earlier and later revision, oldest first. */
  history(recordId: string): WitnessRecord[] {
    let r = this.records.get(recordId);
    if (!r) throw new WitnessError(404, 'Record not found.');
    while (r.payload.supersedes) r = this.records.get(r.payload.supersedes)!;
    const out: WitnessRecord[] = [structuredClone(r)];
    while (r.supersededBy) {
      r = this.records.get(r.supersededBy)!;
      out.push(structuredClone(r));
    }
    return out;
  }

  confirm(recordId: string, participant: unknown): WitnessRecord {
    const r = this.mustRecord(recordId);
    if (r.status !== 'provisional') throw new WitnessError(409, 'Only provisional records can be confirmed.');
    const alias = typeof participant === 'string' ? participant.trim() : '';
    if (!r.payload.participants.includes(alias)) throw new WitnessError(400, 'Not a participant in this record.');
    if (!r.evidence.confirmedBy.includes(alias)) r.evidence.confirmedBy.push(alias);
    if (r.evidence.confirmedBy.length === 2 && !r.evidence.methods.includes('participant-confirmed')) {
      r.evidence.methods.push('participant-confirmed');
    }
    return structuredClone(r);
  }

  /** Irreversible: writes the signed payload to the ledger. */
  async publish(recordId: string): Promise<WitnessRecord> {
    const r = this.mustRecord(recordId);
    if (r.status !== 'provisional') throw new WitnessError(409, `Record is ${r.status}; only provisional records can be published.`);
    let lastErr: unknown;
    for (let attempt = 0; attempt < this.publishRetries; attempt++) {
      try {
        r.ledgerRef = await this.publisher.publish(r.payload, r.signature);
        r.publishError = null;
        r.status = 'recorded';
        const s = this.sessions.get(r.sessionId);
        if (s) this.emit(s, 'result.recorded', r.payload.observedTo, 'observed', { recordId: r.id, ledgerRef: r.ledgerRef });
        return structuredClone(r);
      } catch (err) {
        lastErr = err;
        await new Promise((res) => setTimeout(res, 50 * 2 ** attempt));
      }
    }
    r.publishError = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new WitnessError(503, `Publishing failed; the record stays provisional and can be retried. (${r.publishError})`);
  }

  dispute(recordId: string, by: unknown, reason: unknown): WitnessRecord {
    const r = this.mustRecord(recordId);
    if (r.status === 'corrected') throw new WitnessError(409, 'This record has been corrected; dispute the latest version instead.');
    if (r.status === 'inconclusive') throw new WitnessError(409, 'Inconclusive records cannot be disputed.');
    const text = typeof reason === 'string' ? reason.trim() : '';
    if (text.length < 5 || text.length > 1000) throw new WitnessError(400, 'Give a reason between 5 and 1000 characters.');
    const who = validateAlias(by);
    r.disputes.push({ id: id('dsp'), by: who, reason: text, createdAt: Date.now() });
    r.status = 'disputed';
    const s = this.sessions.get(r.sessionId);
    if (s) this.emit(s, 'result.disputed', Date.now(), 'degraded', { recordId: r.id, by: who });
    return structuredClone(r);
  }

  /**
   * Append-only correction after human review. The original stays on the
   * ledger; a new entry supersedes it and the public page shows the new one.
   */
  async correct(recordId: string, input: { matches?: unknown; reason?: unknown; reviewer?: unknown }): Promise<WitnessRecord> {
    const old = this.mustRecord(recordId);
    if (old.status !== 'recorded' && old.status !== 'disputed') {
      throw new WitnessError(409, 'Only published records that have not already been corrected can be corrected.');
    }
    if (!old.ledgerRef) throw new WitnessError(409, 'Record was never published; it cannot be corrected.');
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (reason.length < 5) throw new WitnessError(400, 'A correction needs a reason.');
    const reviewer = validateAlias(input.reviewer);
    if (!Array.isArray(input.matches) || input.matches.length === 0) throw new WitnessError(400, 'matches is required.');
    const matches = input.matches.map((m) => {
      const scores = (m as { scores?: unknown })?.scores;
      if (!isScorePair(scores)) throw new WitnessError(400, 'Each match needs scores: [number, number].');
      const winner: 0 | 1 | null = scores[0] > scores[1] ? 0 : scores[1] > scores[0] ? 1 : null;
      return { scores, winner };
    });
    const wins: [number, number] = [0, 0];
    for (const m of matches) if (m.winner !== null) wins[m.winner]++;
    const needed = old.payload.format === 'bo3' ? 2 : 1;
    const winner = wins[0] >= needed ? 0 : wins[1] >= needed ? 1 : null;

    const newId = id('rec');
    const prior = this.evidence.get(old.id)!;
    const salt = newSalt();
    const bundle = { correctionOf: old.id, priorFingerprint: old.payload.evidenceFingerprint, reviewer, reason, matches, prior: prior.bundle };
    this.evidence.set(newId, { salt, bundle });
    const payload: OnChainPayload = {
      ...old.payload,
      recordId: newId,
      matches,
      winner,
      evidenceFingerprint: fingerprintEvidence(bundle, salt),
      supersedes: old.id,
      issuedAt: Date.now(),
    };
    const rec: WitnessRecord = {
      id: newId,
      sessionId: old.sessionId,
      status: 'provisional',
      payload,
      signature: this.issuer.sign(payload),
      evidence: { ...structuredClone(old.evidence), methods: [...new Set<EvidenceMethod>([...old.evidence.methods, 'human-reviewed'])] },
      ledgerRef: null,
      publishError: null,
      supersededBy: null,
      correctionReason: reason,
      disputes: [],
      createdAt: Date.now(),
    };
    this.records.set(newId, rec);
    await this.publish(newId);
    old.status = 'corrected';
    old.supersededBy = newId;
    const s = this.sessions.get(old.sessionId);
    if (s) this.emit(s, 'result.corrected', Date.now(), 'observed', { recordId: old.id, correctedBy: newId, reason });
    return structuredClone(rec);
  }

  /** Independent checks anyone can run against a public record. */
  async verify(recordId: string): Promise<{
    recordId: string;
    signatureValid: boolean;
    publishedOnLedger: boolean;
    ledgerMatchesRecord: boolean;
    evidenceMatchesFingerprint: boolean;
    issuerKeyId: string;
    issuerPublicKey: string;
  }> {
    const r = this.mustRecord(recordId);
    const signatureValid = verifySignature(r.payload, r.signature, this.issuer.publicKeyPem);
    const entry = r.ledgerRef ? await this.publisher.get(r.ledgerRef) : null;
    const ledgerMatchesRecord = !!entry && canonicalJson(entry.payload) === canonicalJson(r.payload) && entry.signature === r.signature;
    const ev = this.evidence.get(r.id);
    const evidenceMatchesFingerprint = !!ev && fingerprintEvidence(ev.bundle, ev.salt) === r.payload.evidenceFingerprint;
    return {
      recordId: r.id,
      signatureValid,
      publishedOnLedger: !!entry,
      ledgerMatchesRecord,
      evidenceMatchesFingerprint,
      issuerKeyId: this.issuer.keyId,
      issuerPublicKey: this.issuer.publicKeyPem,
    };
  }

  // ---------- events & webhooks ----------

  subscribe(sessionId: string, fn: (e: WitnessEvent) => void): () => void {
    this.mustSession(sessionId);
    let set = this.listeners.get(sessionId);
    if (!set) this.listeners.set(sessionId, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  addWebhook(url: unknown, events: unknown): { id: string; url: string; secret: string; events: EventType[] | null } {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new WitnessError(400, 'url must be http(s).');
    const list = events === undefined || events === null ? null : events;
    if (list !== null && (!Array.isArray(list) || !list.every((e) => typeof e === 'string'))) {
      throw new WitnessError(400, 'events must be a list of event types.');
    }
    const hook: Webhook = { id: id('whk'), url, secret: randomBytes(24).toString('hex'), events: list as EventType[] | null };
    this.webhooks.set(hook.id, hook);
    return { ...hook };
  }

  removeWebhook(hookId: string): void {
    if (!this.webhooks.delete(hookId)) throw new WitnessError(404, 'Webhook not found.');
  }

  private emit(s: SessionInternal, type: EventType, observedAt: number, evidenceStatus: EvidenceStatus, data: Record<string, unknown>): void {
    const e: WitnessEvent = {
      id: id('evt'),
      type,
      sessionId: s.id,
      emittedAt: Date.now(),
      observedAt,
      version: ++s.version,
      evidenceStatus,
      data,
    };
    s.events.push(e);
    for (const fn of this.listeners.get(s.id) ?? []) fn(e);
    for (const hook of this.webhooks.values()) {
      if (hook.events && !hook.events.includes(type)) continue;
      const p = this.deliver(hook, e).finally(() => this.pending.delete(p));
      this.pending.add(p);
    }
  }

  private async deliver(hook: Webhook, e: WitnessEvent): Promise<void> {
    const body = JSON.stringify(e);
    const sig = createHmac('sha256', hook.secret).update(body).digest('hex');
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await this.fetchImpl(hook.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-witness-event-id': e.id, 'x-witness-signature': `sha256=${sig}` },
          body,
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) return;
      } catch {
        // fall through to retry
      }
      await new Promise((res) => setTimeout(res, 100 * 2 ** attempt));
    }
  }

  // ---------- helpers ----------

  private mustSession(sessionId: string): SessionInternal {
    const s = this.sessions.get(sessionId);
    if (!s) throw new WitnessError(404, 'Session not found.');
    return s;
  }

  private mustRecord(recordId: string): WitnessRecord {
    const r = this.records.get(recordId);
    if (!r) throw new WitnessError(404, 'Record not found.');
    return r;
  }

  private publicSession(s: SessionInternal): Session {
    const { tracker: _t, readings: _r, version: _v, ...pub } = s;
    return structuredClone(pub);
  }
}

function isScorePair(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n >= 0 && n < 1_000_000);
}

function parseReading(raw: unknown): FrameReading {
  const r = raw as Partial<FrameReading> | null;
  if (!r || typeof r.t !== 'number' || !Number.isFinite(r.t)) throw new WitnessError(400, 'Each reading needs a numeric t.');
  if (typeof r.readable !== 'boolean') throw new WitnessError(400, 'Each reading needs readable: boolean.');
  if (r.readable && !isScorePair(r.scores)) throw new WitnessError(400, 'Readable readings need scores: [number, number].');
  if (r.screen !== undefined && r.screen !== 'playing' && r.screen !== 'match_end' && r.screen !== 'other') {
    throw new WitnessError(400, 'screen must be playing, match_end or other.');
  }
  return { t: r.t, readable: r.readable, scores: r.readable ? r.scores : undefined, screen: r.screen };
}
