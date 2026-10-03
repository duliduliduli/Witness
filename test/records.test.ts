import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, verifySignature } from '../src/crypto.ts';
import { LocalLedger } from '../src/ledger.ts';
import { Witness, WitnessError } from '../src/service.ts';
import { sampleSeries, simulate } from '../src/simulator.ts';

const base = { game: 'generic-scoreboard', format: 'bo3', participants: ['Drew', 'Alex'], acknowledgePublic: true };

async function finishedSession(w: Witness, opts: Parameters<typeof simulate>[1] = {}) {
  const s = w.createSession(base);
  return w.ingest(s.id, simulate(sampleSeries(), { start: 0, ...opts }));
}

test('session requires public-record acknowledgement and safe aliases', () => {
  const w = new Witness({ publisher: new LocalLedger() });
  assert.throws(() => w.createSession({ ...base, acknowledgePublic: false }), /published permanently/);
  assert.throws(() => w.createSession({ ...base, participants: ['Drew', 'drew@example.com'] }), WitnessError);
  assert.throws(() => w.createSession({ ...base, participants: ['Drew', '555 123 4567'] }), /phone/);
  assert.throws(() => w.createSession({ ...base, participants: ['Drew', 'drew'] }), /different/);
  assert.throws(() => w.createSession({ ...base, game: 'chess' }), /Unsupported game/);
});

test('detected result becomes a provisional, signed record; publishing is explicit', async () => {
  const ledger = new LocalLedger();
  const w = new Witness({ publisher: ledger });
  const s = await finishedSession(w);
  assert.equal(s.status, 'result_detected');
  const rec = w.getRecord(s.recordId!);
  assert.equal(rec.status, 'provisional');
  assert.equal(ledger.size, 0, 'nothing is published before review');
  assert.equal(rec.payload.winner, 0);
  assert.ok(verifySignature(rec.payload, rec.signature, w.issuer.publicKeyPem));

  // The public payload carries no stream URLs, session internals or evidence.
  const keys = Object.keys(rec.payload).sort();
  assert.deepEqual(keys, ['evidenceFingerprint', 'format', 'game', 'issuedAt', 'matches', 'observedFrom', 'observedTo', 'participants', 'recordId', 'schemaVersion', 'supersedes', 'winner']);

  const pub = await w.publish(rec.id);
  assert.equal(pub.status, 'recorded');
  assert.equal(ledger.size, 1);
  const v = await w.verify(rec.id);
  assert.ok(v.signatureValid && v.publishedOnLedger && v.ledgerMatchesRecord && v.evidenceMatchesFingerprint);
  await assert.rejects(w.publish(rec.id), /only provisional/);
});

test('participant confirmation adds an evidence method', async () => {
  const w = new Witness({ publisher: new LocalLedger() });
  const s = await finishedSession(w);
  w.confirm(s.recordId!, 'Drew');
  assert.deepEqual(w.getRecord(s.recordId!).evidence.methods, ['video-observed']);
  const r = w.confirm(s.recordId!, 'Alex');
  assert.deepEqual(r.evidence.methods, ['video-observed', 'participant-confirmed']);
  assert.throws(() => w.confirm(s.recordId!, 'Mallory'), /Not a participant/);
});

test('publishing retries and keeps the record provisional when the ledger is down', async () => {
  const ledger = new LocalLedger();
  const w = new Witness({ publisher: ledger, publishRetries: 2 });
  const s = await finishedSession(w);
  ledger.failNext = 5;
  await assert.rejects(w.publish(s.recordId!), /stays provisional/);
  const r = w.getRecord(s.recordId!);
  assert.equal(r.status, 'provisional');
  assert.equal(r.publishError, 'Ledger unavailable');
  ledger.failNext = 1; // transient: one failure, then success
  assert.equal((await w.publish(s.recordId!)).status, 'recorded');
});

test('auto-publish only happens for high-quality evidence', async () => {
  const ledger = new LocalLedger();
  const w = new Witness({ publisher: ledger });
  const clean = w.createSession({ ...base, autoPublish: true });
  const a = await w.ingest(clean.id, simulate(sampleSeries(), { start: 0 }));
  assert.equal(w.getRecord(a.recordId!).status, 'recorded');

  const messy = w.createSession({ ...base, autoPublish: true });
  const b = await w.ingest(messy.id, simulate(sampleSeries(), { start: 0, blackout: 20 }));
  const rb = w.getRecord(b.recordId!);
  assert.equal(rb.evidence.quality, 'reduced');
  assert.equal(rb.status, 'provisional');
});

test('disputes and append-only corrections keep full history', async () => {
  const ledger = new LocalLedger();
  const w = new Witness({ publisher: ledger });
  const s = await finishedSession(w);
  const original = (await w.publish(s.recordId!)).id;

  const d = w.dispute(original, 'Alex', 'Game 3 was actually 3–4, the last point was missed.');
  assert.equal(d.status, 'disputed');

  const fixed = await w.correct(original, {
    reviewer: 'reviewer-1',
    reason: 'Reviewed footage: final point of game 3 went to Alex.',
    matches: [{ scores: [4, 2] }, { scores: [1, 4] }, { scores: [3, 4] }],
  });
  assert.equal(fixed.status, 'recorded');
  assert.equal(fixed.payload.supersedes, original);
  assert.equal(fixed.payload.winner, 1);
  assert.ok(fixed.evidence.methods.includes('human-reviewed'));
  assert.equal(ledger.size, 2, 'original stays on the ledger; correction is a new entry');

  const old = w.getRecord(original);
  assert.equal(old.status, 'corrected');
  assert.equal(old.supersededBy, fixed.id);
  assert.deepEqual(w.history(original).map((r) => r.id), [original, fixed.id]);
  assert.deepEqual(w.history(fixed.id).map((r) => r.id), [original, fixed.id]);
  await assert.rejects(w.correct(original, { reviewer: 'r', reason: 'again please', matches: [{ scores: [1, 0] }] }), /already been corrected/);
  assert.ok((await w.verify(fixed.id)).ledgerMatchesRecord);
});

test('inconclusive sessions produce no record', async () => {
  const w = new Witness({ publisher: new LocalLedger() });
  const s = w.createSession(base);
  const all = simulate(sampleSeries(), { start: 0 });
  await w.ingest(s.id, all.slice(0, 40));
  const stopped = await w.stop(s.id);
  assert.equal(stopped.status, 'inconclusive');
  assert.equal(stopped.recordId, null);
  await assert.rejects(w.ingest(s.id, all.slice(40)), /no longer accepts/);
});

test('ledger persists, reloads and detects tampering', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'witness-')), 'ledger.jsonl');
  const l1 = new LocalLedger(file);
  await l1.publish({ a: 1 }, 'sig1');
  await l1.publish({ a: 2 }, 'sig2');
  const l2 = new LocalLedger(file);
  assert.equal(l2.size, 2);
  assert.equal(l2.verifyChain(), null);

  const lines = readFileSync(file, 'utf8').trim().split('\n');
  const e = JSON.parse(lines[0]);
  e.payload = { a: 999 };
  lines[0] = JSON.stringify(e);
  writeFileSync(file, lines.join('\n') + '\n');
  assert.throws(() => new LocalLedger(file), /corrupt at height 0/);
});

test('canonical JSON is key-order independent', () => {
  assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] }), canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
});

test('webhooks deliver signed events with ids', async () => {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: init.body as string });
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  const w = new Witness({ publisher: new LocalLedger(), fetch: fakeFetch });
  w.addWebhook('https://example.test/hook', ['session.result_detected', 'result.recorded']);
  const s = await finishedSession(w);
  await w.publish(s.recordId!);
  await Promise.all(w.pending);
  assert.deepEqual(calls.map((c) => JSON.parse(c.body).type), ['session.result_detected', 'result.recorded']);
  assert.match(calls[0].headers['x-witness-signature'], /^sha256=[0-9a-f]{64}$/);
  assert.equal(calls[0].headers['x-witness-event-id'], JSON.parse(calls[0].body).id);
});

test('record times come from the footage, not the server clock', async () => {
  const w = new Witness({ publisher: new LocalLedger() });
  const s = w.createSession(base);
  const readings = simulate(sampleSeries(), { start: 1_000_000 });
  const done = await w.ingest(s.id, readings);
  const p = w.getRecord(done.recordId!).payload;
  assert.equal(p.observedFrom, readings[0].t);
  assert.ok(p.observedTo <= readings.at(-1)!.t && p.observedTo > p.observedFrom);
});
