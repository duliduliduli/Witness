import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { LocalLedger } from '../src/ledger.ts';
import { createWitnessServer } from '../src/server.ts';
import { Witness } from '../src/service.ts';
import { sampleSeries, simulate } from '../src/simulator.ts';

const w = new Witness({ publisher: new LocalLedger() });
const server = createWitnessServer(w, { apiKey: 'k_test', adminKey: 'k_admin' });
let url = '';

before(async () => {
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const call = async (method: string, path: string, body?: unknown, key = 'k_test') => {
  const res = await fetch(url + path, {
    method,
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
};

test('full flow over HTTP: session → readings → record → publish → verify → correct', async () => {
  const denied = await call('POST', '/v1/sessions', {}, '');
  assert.equal(denied.status, 401);

  const created = await call('POST', '/v1/sessions', {
    game: 'generic-scoreboard',
    format: 'bo3',
    participants: ['Drew', 'Alex'],
    acknowledgePublic: true,
  });
  assert.equal(created.status, 201);
  const id = created.body.id;

  const readings = simulate(sampleSeries(), { start: Date.now(), seed: 3, dropRate: 0.03, misreadRate: 0.03 });
  let s: any;
  for (let i = 0; i < readings.length; i += 50) {
    const r = await call('POST', `/v1/sessions/${id}/readings`, { readings: readings.slice(i, i + 50) });
    if (r.status === 409) break;
    assert.equal(r.status, 200);
    s = r.body;
  }
  assert.equal(s.status, 'result_detected');

  const events = await call('GET', `/v1/sessions/${id}/events?after=0`);
  const versions = events.body.events.map((e: any) => e.version);
  assert.deepEqual(versions, [...versions].sort((a: number, b: number) => a - b));
  assert.ok(events.body.events.every((e: any) => e.id && e.emittedAt && e.observedAt && e.evidenceStatus));

  const pub = await call('POST', `/v1/records/${s.recordId}/publish`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.status, 'recorded');

  const v = await call('GET', `/v1/records/${s.recordId}/verify`, undefined, '');
  assert.equal(v.body.signatureValid && v.body.ledgerMatchesRecord, true);

  const page = await call('GET', `/r/${s.recordId}`, undefined, '');
  assert.equal(page.status, 200);
  assert.match(page.body, /Drew wins 2–1/);

  const noAdmin = await call('POST', `/v1/records/${s.recordId}/corrections`, { reason: 'x', matches: [] });
  assert.equal(noAdmin.status, 401);
  const corr = await call(
    'POST',
    `/v1/records/${s.recordId}/corrections`,
    { reviewer: 'ref', reason: 'Game 2 review', matches: [{ scores: [4, 2] }, { scores: [4, 3] }] },
    'k_admin',
  );
  assert.equal(corr.status, 200);
  const oldPage = await call('GET', `/r/${s.recordId}`, undefined, '');
  assert.match(oldPage.body, /earlier version/);
});

test('live page escapes participant aliases and errors are JSON', async () => {
  const bad = await call('POST', '/v1/sessions', { game: 'generic-scoreboard', participants: ['<b>x', 'y'], acknowledgePublic: true });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error);
  const missing = await call('GET', '/v1/records/rec_nope', undefined, '');
  assert.equal(missing.status, 404);
  const wrongMethod = await call('DELETE', '/v1/sessions');
  assert.equal(wrongMethod.status, 405);
});

test('SSE stream replays the session events', async () => {
  const created = await call('POST', '/v1/sessions', { game: 'generic-scoreboard', participants: ['A1', 'B1'], acknowledgePublic: true });
  const ctrl = new AbortController();
  const res = await fetch(`${url}/v1/sessions/${created.body.id}/stream`, { signal: ctrl.signal });
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  ctrl.abort();
  assert.match(new TextDecoder().decode(value), /"type":"session.started"/);
});
