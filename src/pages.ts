import type { Session } from './service.ts';
import type { RecordStatus, WitnessRecord } from './types.ts';

function esc(v: unknown): string {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** JSON safe to embed inside a <script> tag. */
function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c');
}

const STYLE = `
:root{--bg:#f7f7f5;--panel:#fff;--text:#1b1b1f;--muted:#62626b;--line:#e3e3e0;--accent:#2f5bd3;--ok:#1f7a4d;--warn:#a1620b;--bad:#b3261e;--chip:#eef0f6}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--panel:#1b1b1f;--text:#ececf1;--muted:#a0a0aa;--line:#2c2c33;--accent:#8aa8ff;--ok:#5cc690;--warn:#f0b35a;--bad:#ff8a80;--chip:#262a36}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 64px}
header.top{display:flex;align-items:baseline;gap:12px;margin-bottom:24px}header.top a{color:inherit;text-decoration:none;font-weight:700;font-size:20px}
header.top span{color:var(--muted);font-size:14px}
h1{font-size:28px;margin:0 0 8px}h2{font-size:18px;margin:28px 0 10px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px;margin:14px 0}
.muted{color:var(--muted)}.small{font-size:14px}
label{display:block;font-weight:600;margin:14px 0 6px}input,select,textarea{width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);font:inherit}
.row{display:flex;gap:12px}.row>*{flex:1}
button{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:10px 16px;font:inherit;font-weight:600;cursor:pointer}button.secondary{background:var(--chip);color:var(--text)}
button:disabled{opacity:.5;cursor:default}
.check{display:flex;gap:10px;align-items:flex-start;font-weight:400}.check input{width:auto;margin-top:4px}
.score{font-size:56px;font-weight:800;letter-spacing:2px;text-align:center;font-variant-numeric:tabular-nums}
.players{display:flex;justify-content:space-between;font-weight:600}
.chip{display:inline-block;padding:2px 10px;border-radius:999px;background:var(--chip);font-size:13px;font-weight:600}
.s-recorded,.s-observed,.s-high{color:var(--ok)}.s-provisional,.s-watching,.s-degraded,.s-reduced,.s-disputed{color:var(--warn)}.s-inconclusive,.s-insufficient,.s-corrected{color:var(--bad)}
ul.feed{list-style:none;padding:0;margin:0;max-height:320px;overflow:auto}ul.feed li{padding:6px 0;border-bottom:1px solid var(--line);font-size:14px}
ul.feed time{color:var(--muted);font-variant-numeric:tabular-nums;margin-right:8px}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:6px 4px;border-bottom:1px solid var(--line);vertical-align:top}
code{font-size:12px;word-break:break-all}
.banner{border-left:4px solid var(--warn);padding:10px 14px;background:var(--panel);border-radius:6px;margin:12px 0}
`;

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head><body><main>
<header class="top"><a href="/">Witness</a><span>Watch it happen. Put it on record.</span></header>
${body}</main></body></html>`;
}

const STATUS_TEXT: Record<RecordStatus, string> = {
  provisional: 'Provisional: a result was detected but has not been published yet.',
  recorded: 'Recorded: this report was published to the ledger. Recorded means published, not guaranteed true.',
  disputed: 'Disputed: someone has challenged this report.',
  corrected: 'Corrected: a later report supersedes this one.',
  inconclusive: 'Inconclusive: the evidence cannot establish the result.',
};

export function homePage(devMode: boolean): string {
  return layout(
    'Witness',
    `<h1>Watch a match</h1>
<p class="muted">Witness watches a supported stream, tracks the score, and publishes the result as a permanent public record that anyone can verify.</p>
<form class="card" id="f">
  <div class="row"><div><label for="p0">Player 1 alias</label><input id="p0" required maxlength="32" value="Drew"></div>
  <div><label for="p1">Player 2 alias</label><input id="p1" required maxlength="32" value="Alex"></div></div>
  <div class="row"><div><label for="game">Game</label><select id="game"><option value="generic-scoreboard">Generic scoreboard (development)</option></select></div>
  <div><label for="format">Format</label><select id="format"><option value="bo3">Best of three</option><option value="single">Single match</option></select></div></div>
  <label for="src">Source</label><select id="src"><option value="simulated">Simulated stream (demo)</option><option value="push">Connected analyzer (API)</option></select>
  <label class="check"><input type="checkbox" id="ack" required> <span>I understand the final result (these aliases, scores, winner and times) will be published permanently and <b>cannot be deleted</b>. Use aliases, not real names or contact details.</span></label>
  <p><button ${devMode ? '' : 'disabled'}>Start observing</button></p>
  ${devMode ? '' : '<p class="small muted">This server requires an API key; start sessions through the API.</p>'}
  <p class="small" id="err" style="color:var(--bad)"></p>
</form>
<script>
document.getElementById('f').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const v = (id) => document.getElementById(id).value;
  const res = await fetch('/v1/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    game: v('game'), format: v('format'), participants: [v('p0'), v('p1')], source: { kind: v('src') },
    acknowledgePublic: document.getElementById('ack').checked }) });
  const out = await res.json();
  if (!res.ok) { document.getElementById('err').textContent = out.error; return; }
  location.href = '/s/' + out.id;
});
</script>`,
  );
}

export function livePage(s: Session, devMode: boolean): string {
  return layout(
    `Watching · ${s.participants.join(' vs ')}`,
    `<h1 id="title">Witness is watching</h1>
<p class="muted" id="sub">${esc(s.participants[0])} vs ${esc(s.participants[1])} · ${s.format === 'bo3' ? 'Best of three' : 'Single match'} · <span class="chip" id="status">${esc(s.status)}</span></p>
<div class="card">
  <div class="players"><span>${esc(s.participants[0])}</span><span id="match" class="muted small"></span><span>${esc(s.participants[1])}</span></div>
  <div class="score" id="score">– : –</div>
  <div class="players small muted"><span id="w0"></span><span id="w1"></span></div>
</div>
<div id="warn"></div>
<div class="card" id="result" hidden></div>
<h2>Event feed</h2>
<div class="card"><ul class="feed" id="feed"></ul></div>
${s.source.kind === 'push' ? `<p class="small muted">Waiting for readings at <code>POST /v1/sessions/${esc(s.id)}/readings</code>.</p>` : ''}
${devMode ? `<p><button class="secondary" id="stop">Stop observing</button></p>` : ''}
<script>
const S = ${scriptJson({ id: s.id, participants: s.participants, devMode })};
const $ = (id) => document.getElementById(id);
const wins = [0, 0];
const fmt = (t) => new Date(t).toLocaleTimeString();
function line(e) {
  const d = e.data, p = S.participants;
  switch (e.type) {
    case 'session.started': return 'Session started.';
    case 'match.started': return 'Match ' + d.match + ' started.';
    case 'score.updated': {
      const who = d.scores[0] > d.previous[0] ? p[0] : d.scores[1] > d.previous[1] ? p[1] : null;
      return (who ? who + ' scored. ' : 'Score changed. ') + 'Score ' + d.scores.join('–') + '.';
    }
    case 'match.result_detected': return 'Match ' + d.match + ' ended ' + d.scores.join('–') + (d.winner === null ? ', winner could not be established.' : ', ' + p[d.winner] + ' wins.');
    case 'evidence.warning': return '⚠ ' + d.message;
    case 'session.result_detected': return 'Result detected: ' + p[d.winner] + ' wins ' + d.wins[d.winner] + '–' + d.wins[1 - d.winner] + '.';
    case 'session.inconclusive': return 'Inconclusive: ' + d.reason;
    case 'result.recorded': return 'Published to the ledger.';
    case 'result.disputed': return 'Result disputed by ' + d.by + '.';
    case 'result.corrected': return 'Result corrected: ' + d.reason;
  }
  return e.type;
}
async function showRecord() {
  const s = await (await fetch('/v1/sessions/' + S.id)).json();
  $('status').textContent = s.status; $('status').className = 'chip s-' + s.status;
  if (s.status !== 'watching' && $('stop')) $('stop').hidden = true;
  if (!s.recordId) return;
  const { record: r } = await (await fetch('/v1/records/' + s.recordId)).json();
  const box = $('result'); box.hidden = false;
  const w = r.payload.winner;
  box.innerHTML = '<h2 style="margin-top:0">' + (w === null ? 'No winner established' : S.participants[w] + ' wins') + '</h2>' +
    '<p>Record <a href="/r/' + r.id + '">' + r.id + '</a> · <span class="chip s-' + r.status + '">' + r.status + '</span> · evidence <span class="chip s-' + r.evidence.quality + '">' + r.evidence.quality + '</span></p>' +
    (r.status === 'provisional' && S.devMode ? '<p class="small muted">Check the result before publishing. Publishing is permanent.</p><p><button id="pub">Publish to the ledger</button></p>' : '');
  const b = $('pub');
  if (b) b.onclick = async () => {
    b.disabled = true;
    const res = await fetch('/v1/records/' + r.id + '/publish', { method: 'POST' });
    if (res.ok) location.href = '/r/' + r.id; else { b.disabled = false; alert((await res.json()).error); }
  };
}
const es = new EventSource('/v1/sessions/' + S.id + '/stream');
es.onmessage = (m) => {
  const e = JSON.parse(m.data), d = e.data;
  const li = document.createElement('li');
  li.innerHTML = '<time></time><span></span>';
  li.firstChild.textContent = fmt(e.observedAt); li.lastChild.textContent = line(e);
  $('feed').prepend(li);
  if (e.type === 'match.started' || e.type === 'score.updated') { $('score').textContent = d.scores.join(' : '); $('match').textContent = 'Match ' + d.match; }
  if (e.type === 'match.result_detected') { $('score').textContent = d.scores.join(' : '); if (d.winner !== null) wins[d.winner]++; $('w0').textContent = 'Wins: ' + wins[0]; $('w1').textContent = 'Wins: ' + wins[1]; }
  if (e.type === 'evidence.warning') { $('warn').innerHTML = '<div class="banner"></div>'; $('warn').firstChild.textContent = d.message; }
  if (e.type === 'session.result_detected' || e.type === 'session.inconclusive' || e.type === 'result.recorded') {
    $('title').textContent = e.type === 'session.inconclusive' ? 'Observation inconclusive' : 'Result detected';
    showRecord();
  }
};
const stop = $('stop');
if (stop) stop.onclick = async () => { stop.disabled = true; await fetch('/v1/sessions/' + S.id + '/stop', { method: 'POST' }); showRecord(); };
</script>`,
  );
}

type Verification = {
  signatureValid: boolean;
  publishedOnLedger: boolean;
  ledgerMatchesRecord: boolean;
  evidenceMatchesFingerprint: boolean;
  issuerKeyId: string;
};

export function recordPage(requestedId: string, history: WitnessRecord[], v: Verification, devMode: boolean): string {
  const latest = history.at(-1)!;
  const p = latest.payload;
  const names = p.participants;
  const tick = (ok: boolean) => (ok ? '<span class="s-recorded">✓</span>' : '<span class="s-inconclusive">✗</span>');
  const winnerText = p.winner === null ? 'No winner established' : `${esc(names[p.winner])} wins`;
  const seriesScore =
    p.format === 'bo3' && p.winner !== null
      ? ` ${p.matches.filter((m) => m.winner === p.winner).length}–${p.matches.filter((m) => m.winner === 1 - p.winner!).length}`
      : '';

  return layout(
    `${names.join(' vs ')} · Witness record`,
    `${requestedId !== latest.id ? `<div class="banner">You followed a link to an earlier version (${esc(requestedId)}). It has been corrected; the current report is shown below.</div>` : ''}
<p class="muted small">${esc(p.game)} · ${p.format === 'bo3' ? 'Best of three' : 'Single match'} · ${esc(new Date(p.observedFrom).toUTCString())}</p>
<h1>${winnerText}${seriesScore}</h1>
<p>${esc(names[0])} vs ${esc(names[1])} · <span class="chip s-${latest.status}">${esc(latest.status)}</span> · evidence quality <span class="chip s-${latest.evidence.quality}">${esc(latest.evidence.quality)}</span></p>
<p class="small muted">${esc(STATUS_TEXT[latest.status])}</p>

<div class="card"><table><tr><th>Match</th><th>${esc(names[0])}</th><th>${esc(names[1])}</th><th>Winner</th></tr>
${p.matches.map((m, i) => `<tr><td>${i + 1}</td><td>${m.scores[0]}</td><td>${m.scores[1]}</td><td>${m.winner === null ? '<span class="s-inconclusive">not established</span>' : esc(names[m.winner])}</td></tr>`).join('')}
</table></div>

<h2>Evidence</h2>
<div class="card small">
<p>Methods: ${latest.evidence.methods.map((m) => `<span class="chip">${esc(m)}</span>`).join(' ')}</p>
<p>Readable footage: ${Math.round(latest.evidence.coverage * 100)}%${latest.evidence.confirmedBy.length ? ` · confirmed by ${latest.evidence.confirmedBy.map(esc).join(', ')}` : ''}</p>
${latest.evidence.warnings.length ? `<ul>${latest.evidence.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '<p>No evidence warnings.</p>'}
${latest.correctionReason ? `<p><b>Correction reason:</b> ${esc(latest.correctionReason)}</p>` : ''}
</div>

<h2>Verification</h2>
<div class="card small"><table>
<tr><td>${tick(v.signatureValid)}</td><td>Signed by Witness issuer key <code>${esc(v.issuerKeyId)}</code></td></tr>
<tr><td>${tick(v.publishedOnLedger)}</td><td>${latest.ledgerRef ? `Published on <b>${esc(latest.ledgerRef.network)}</b> at height ${latest.ledgerRef.height}, tx <code>${esc(latest.ledgerRef.txHash)}</code>` : 'Not yet published'}</td></tr>
<tr><td>${tick(v.ledgerMatchesRecord)}</td><td>Ledger entry matches this report</td></tr>
<tr><td>${tick(v.evidenceMatchesFingerprint)}</td><td>Retained evidence matches fingerprint <code>${esc(p.evidenceFingerprint)}</code></td></tr>
</table><p class="muted">These checks show the report hasn't been altered since publication. They don't show the footage was authentic or the AI was right.</p></div>

<h2>History</h2>
<div class="card small"><table>
${history.map((r) => `<tr><td><a href="/r/${esc(r.id)}">${esc(r.id)}</a></td><td><span class="chip s-${r.status}">${esc(r.status)}</span></td><td>${r.payload.matches.map((m) => m.scores.join('–')).join(', ')}</td><td>${r.payload.supersedes ? `corrects ${esc(r.payload.supersedes)}` : 'original'}</td></tr>`).join('')}
</table>
${latest.disputes.length ? `<p><b>Disputes</b></p><ul>${latest.disputes.map((d) => `<li>${esc(d.by)}: ${esc(d.reason)}</li>`).join('')}</ul>` : ''}
</div>

${
  devMode && (latest.status === 'recorded' || latest.status === 'disputed' || latest.status === 'provisional')
    ? `<h2>Dispute this result</h2><form class="card" id="d"><label for="by">Your alias</label><input id="by" maxlength="32" required>
<label for="reason">What's wrong?</label><textarea id="reason" rows="3" required minlength="5"></textarea><p><button>Submit dispute</button></p><p class="small" id="err" style="color:var(--bad)"></p></form>
<script>
document.getElementById('d').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const res = await fetch('/v1/records/${esc(latest.id)}/disputes', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ by: document.getElementById('by').value, reason: document.getElementById('reason').value }) });
  if (res.ok) location.reload(); else document.getElementById('err').textContent = (await res.json()).error;
});
</script>`
    : ''
}`,
  );
}

export function notFoundPage(message: string): string {
  return layout('Witness', `<h1>Not available</h1><p class="muted">${esc(message)}</p><p><a href="/">Back to Witness</a></p>`);
}
