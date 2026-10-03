// End-to-end demo: a noisy best-of-three between Drew and Alex is observed,
// the result is detected without anyone typing a score, published to the
// ledger, verified, disputed and corrected.
import { LocalLedger } from '../src/ledger.ts';
import { Witness } from '../src/service.ts';
import { sampleSeries, simulate } from '../src/simulator.ts';

const ledger = new LocalLedger();
const w = new Witness({ publisher: ledger });

const session = w.createSession({
  game: 'generic-scoreboard',
  format: 'bo3',
  participants: ['Drew', 'Alex'],
  acknowledgePublic: true,
});
w.subscribe(session.id, (e) => {
  if (e.type === 'score.updated') return;
  const t = new Date(e.observedAt).toISOString().slice(11, 19);
  console.log(`${t}  ${e.type.padEnd(24)} ${e.evidenceStatus.padEnd(12)} ${JSON.stringify(e.data)}`);
});

const readings = simulate(sampleSeries(), { start: Date.parse('2026-10-03T19:00:00Z'), seed: 42, dropRate: 0.05, misreadRate: 0.05 });
console.log(`Feeding ${readings.length} noisy scoreboard readings (5% unreadable, 5% misread)…\n`);
const done = await w.ingest(session.id, readings);

const rec = await w.publish(done.recordId!);
console.log('\nPublished record:');
console.log(JSON.stringify({ id: rec.id, status: rec.status, payload: rec.payload, evidence: rec.evidence, ledgerRef: rec.ledgerRef }, null, 2));
console.log('\nVerification:', await w.verify(rec.id).then(({ issuerPublicKey: _k, ...v }) => v));

w.dispute(rec.id, 'Alex', 'I think game 2 was 4-0, not 4-1.');
const fixed = await w.correct(rec.id, {
  reviewer: 'reviewer',
  reason: 'Reviewed footage: game 2 was 0–4.',
  matches: [{ scores: [4, 2] }, { scores: [0, 4] }, { scores: [4, 2] }],
});
console.log('\nHistory after correction:');
for (const r of w.history(fixed.id)) {
  console.log(`  ${r.id}  ${r.status.padEnd(10)} ${r.payload.matches.map((m) => m.scores.join('–')).join(', ')}  ${r.payload.supersedes ? `(corrects ${r.payload.supersedes})` : '(original)'}`);
}
console.log(`\nLedger entries: ${ledger.size}, chain intact: ${ledger.verifyChain() === null}`);
