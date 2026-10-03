import type { Session } from './service.ts';
import type { RecordStatus, WitnessRecord } from './types.ts';

function esc(v: unknown): string {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** JSON safe to embed inside a <script> tag. */
function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c');
}

function ago(t: number): string {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Self-hosted variable fonts (SIL OFL): Inter Tight and JetBrains Mono, latin subset.
const FONT_FACES = `@font-face{font-family:"Inter Tight";font-style:normal;font-weight:100 900;font-display:swap;src:url(/fonts/InterTight.woff2) format("woff2")}
@font-face{font-family:"JetBrains Mono";font-style:normal;font-weight:100 800;font-display:swap;src:url(/fonts/JetBrainsMono.woff2) format("woff2")}`;

const STYLE = `
:root{color-scheme:light;--bg:#f2f0eb;--paper:#f7f6f2;--ink:#0e0e0d;--ink-2:#3a3936;--muted:#77756f;--line:#d8d5cd;--line-2:#e6e3dc;
--accent:#f05a14;--accent-ink:#fff;--ok:#2f7d4e;--bad:#b3261e;--feed:#121211;
--sans:"Inter Tight",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 var(--sans);-webkit-font-smoothing:antialiased}
a{color:inherit}
.wrap{max-width:1440px;margin:0 auto;padding:0 clamp(16px,4vw,64px)}
.mono{font-family:var(--mono);font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.rule{border:0;border-top:1px solid var(--line);margin:0}

/* nav */
.nav{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;height:72px;border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:14px;text-decoration:none;font-family:var(--mono);font-size:15px;letter-spacing:.32em;font-weight:500}
.links{display:flex;gap:clamp(18px,3vw,40px)}
.links a{text-decoration:none;font-size:16px;color:var(--ink-2);position:relative;padding:6px 0}
.links a.on{color:var(--ink)}.links a.on::after{content:"";position:absolute;left:50%;bottom:-6px;width:5px;height:5px;margin-left:-2.5px;border-radius:50%;background:var(--accent)}
.cta{justify-self:end}
.btn{display:inline-flex;align-items:center;gap:12px;background:var(--ink);color:#fff;border:0;border-radius:2px;padding:12px 24px;font:500 16px var(--sans);text-decoration:none;cursor:pointer;white-space:nowrap}
.btn:hover{background:#2a2a28}.btn:disabled{opacity:.45;cursor:default}
.btn.mono-btn{font-family:var(--mono);font-size:13px;letter-spacing:.06em}
.btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--ink)}.btn.ghost:hover{background:var(--ink);color:#fff}
.arrow{width:14px;height:14px;flex:none}

/* hero */
.hero{display:grid;grid-template-columns:minmax(0,.93fr) minmax(0,1.07fr);gap:clamp(20px,2vw,28px);padding:16px 0 26px;align-items:start}
.hero>div:first-child{padding-top:26px}
.display{font-family:var(--sans);font-weight:900;letter-spacing:-.045em;word-spacing:.04em;line-height:.88;margin:0;font-size:clamp(52px,6.9vw,116px)}
.display span{white-space:nowrap}
.lede{font-size:clamp(20px,1.9vw,25px);color:var(--ink-2);margin:20px 0 28px;letter-spacing:-.01em}
.field{display:flex;align-items:stretch;border:1px solid var(--line);background:var(--paper);height:58px}
.field svg{flex:none;width:20px;margin:0 6px 0 22px;align-self:center;color:var(--muted)}
.field input{flex:1;min-width:0;border:0;background:transparent;font:italic 19px var(--sans);color:var(--ink);padding:0 14px;outline:none}
.field input::placeholder{color:#a6a39b}
.go{flex:none;width:76px;border:0;background:var(--accent);color:var(--accent-ink);cursor:pointer;display:grid;place-items:center}
.go:hover{filter:brightness(1.06)}.go svg{width:20px;height:20px;margin:0;color:#fff}
.field:focus-within{border-color:var(--ink)}
label.q{display:block;font-size:16px;color:var(--ink-2);margin:24px 0 10px}
.box{width:100%;border:1px solid var(--line);background:var(--paper);padding:12px 16px;font:15px var(--sans);color:var(--ink);outline:none;border-radius:0}
.box:focus{border-color:var(--ink)}
.examples{display:flex;align-items:center;flex-wrap:wrap;gap:14px;margin-top:18px}
.chip{border:1px solid var(--ink-2);border-radius:999px;background:transparent;padding:7px 18px;font:15px var(--sans);color:var(--ink);cursor:pointer}
.chip:hover,.chip[aria-pressed=true]{background:var(--ink);color:#fff}
.chip[disabled]{border-color:var(--line);color:var(--muted);cursor:default;background:transparent}
.chip small{font-family:var(--mono);font-size:10px;letter-spacing:.1em;margin-left:6px;text-transform:uppercase}
.setup{display:grid;grid-template-columns:1fr 1fr auto;gap:14px;margin-top:22px;padding-top:20px;border-top:1px solid var(--line)}
.setup .mono{display:block;margin-bottom:6px}
.seg{display:flex;border:1px solid var(--line);background:var(--paper);height:46px}
.seg label{display:grid;place-items:center;padding:0 16px;cursor:pointer;font-size:14px;color:var(--ink-2)}
.seg input{position:absolute;opacity:0;pointer-events:none}
.seg label:has(input:checked){background:var(--ink);color:#fff}
.ack{display:flex;gap:12px;align-items:flex-start;margin-top:16px;font-size:14px;color:var(--ink-2);line-height:1.45}
.ack input{margin-top:3px;accent-color:var(--accent);width:16px;height:16px;flex:none}
.err{color:var(--bad);font-size:14px;min-height:20px;margin:10px 0 0}
.tiles{display:grid;grid-template-columns:353fr 376fr;gap:10px}
.tiles img{display:block;width:100%;height:auto;background:var(--feed)}
.tiles-note{grid-column:1/-1;text-align:right;font-size:10px;margin-top:2px}
.rail{border-left:1px solid var(--line);padding-left:16px;display:flex;flex-direction:column;justify-content:space-between;gap:24px}
.rail .mono{font-size:10.5px;line-height:1.5}

/* sections */
.sec-head{display:flex;justify-content:space-between;align-items:center;padding:18px 0;border-top:1px solid var(--line)}
.sec-head .mono{color:var(--ink-2);font-size:13px;letter-spacing:.2em}
.watching{display:flex;align-items:center;gap:10px;font-size:16px}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--accent);flex:none}
.dot.live{animation:pulse 1.6s ease-in-out infinite}
.d-recorded,.d-result_detected{background:var(--ok)}.d-corrected,.d-inconclusive{background:var(--bad)}.d-disputed{background:#b8460c}
@keyframes pulse{50%{opacity:.35}}

.obs{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr) 88px;gap:20px;padding-bottom:20px}
.feed{position:relative;background:var(--feed);color:#fff;aspect-ratio:863/304;overflow:hidden;display:grid;place-items:center;
 background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);background-size:48px 48px}
.feed.game{background:var(--feed) url(/img/gaming-plain.jpg) center/cover}
.feed.game::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,10,9,.55),rgba(10,10,9,.78))}
.feed.photo{aspect-ratio:auto;display:block;background:transparent;align-self:start}.feed.photo img{display:block;width:100%;height:auto}.feed.photo .mono{display:block;margin-top:10px;font-size:10.5px;text-align:left}.feed.photo::after{display:none}
.feed::after{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 70% 20%,rgba(240,90,20,.18),transparent 60%);pointer-events:none}
.tag{position:absolute;top:16px;left:16px;display:flex;align-items:center;gap:10px;background:rgba(0,0,0,.72);padding:8px 14px;font-family:var(--mono);font-size:13px;letter-spacing:.04em;z-index:1}
.tag .dot{width:9px;height:9px}
.board{text-align:center;position:relative;z-index:1;width:100%;padding:0 24px}
.board .names{display:grid;grid-template-columns:1fr auto 1fr;align-items:end;gap:20px;font-size:clamp(14px,1.6vw,20px);font-weight:600}
.board .names span:first-child{text-align:right}.board .names span:last-child{text-align:left}
.board .nums{font-weight:900;letter-spacing:-.04em;font-size:clamp(64px,9vw,136px);line-height:1;font-variant-numeric:tabular-nums}
.board .nums i{font-style:normal;font-weight:300;color:rgba(255,255,255,.3);padding:0 .1em;position:relative;top:-.06em}
.board .sub{font-family:var(--mono);font-size:12px;letter-spacing:.14em;color:rgba(255,255,255,.6);text-transform:uppercase;margin-top:10px}
.panel{border-top:1px solid var(--line);padding-top:16px;display:flex;flex-direction:column}
.panel-top{display:flex;justify-content:space-between;padding-bottom:12px;border-bottom:2px solid var(--ink)}
.panel-top .mono{color:var(--ink-2)}
.panel h2{font-weight:800;letter-spacing:-.05em;font-size:clamp(34px,3.6vw,52px);line-height:1;margin:22px 0 18px}
.kv{width:100%;border-collapse:collapse;font-size:15px}
.kv td{padding:10px 0;border-top:1px solid var(--line)}.kv tr:last-child td{border-bottom:1px solid var(--line)}
.kv td:first-child{color:var(--ink-2);width:40%}
.kv .dot{width:8px;height:8px;margin-right:10px;vertical-align:1px}
.panel .actions{margin-top:22px;display:flex;gap:12px;flex-wrap:wrap}
.note{font-size:13px;color:var(--muted);margin:12px 0 0}

/* lists */
.records{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid var(--line)}
.rec{display:grid;grid-template-columns:124px 1fr auto;gap:18px;align-items:center;padding:14px 20px 14px 0;text-decoration:none}
.records .rec+.rec{border-left:1px solid var(--line);padding-left:20px}
.rec:hover .t{text-decoration:underline}
.thumb{height:72px;border-radius:3px;background-size:cover!important;background-position:center!important;background:var(--feed);color:#fff;display:grid;place-items:center;font-weight:900;font-size:26px;letter-spacing:-.03em;position:relative;overflow:hidden;
 background-image:linear-gradient(rgba(255,255,255,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.06) 1px,transparent 1px);background-size:14px 14px}
.thumb.empty{color:rgba(255,255,255,.5);font:500 11px var(--mono);letter-spacing:.14em}
.rec .t{font-weight:600;font-size:17px}.rec .s{color:var(--ink-2);font-size:15px}.rec .m{color:var(--muted);font-size:14px;display:flex;align-items:center;gap:8px}
.rec .m .dot{width:8px;height:8px}
.rows .rec{grid-template-columns:132px 1fr auto;border-bottom:1px solid var(--line);padding:16px 0}
.log{list-style:none;margin:0;padding:0;max-height:420px;overflow:auto}
.log li{display:grid;grid-template-columns:110px 1fr;gap:16px;padding:12px 0;border-bottom:1px solid var(--line-2);font-size:15px}
.log time{font-family:var(--mono);font-size:12.5px;color:var(--muted);padding-top:2px;font-variant-numeric:tabular-nums}
.log .w{color:#b8460c}
.banner{display:flex;gap:12px;align-items:center;border:1px solid var(--line);background:var(--paper);padding:12px 16px;margin:0 0 20px;font-size:14px}
.banner .dot{width:8px;height:8px}

/* record */
.page{padding:44px 0 80px}
.page .display{font-size:clamp(48px,7vw,112px);margin:18px 0 22px}
.meta{display:flex;flex-wrap:wrap;gap:8px 22px}
.pill{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);padding:4px 12px;border-radius:999px;font-size:14px;background:var(--paper)}
.pill .dot{width:8px;height:8px}
.grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 56px}
.block{padding-bottom:36px}
table.data{width:100%;border-collapse:collapse;font-size:15px}
table.data th{font-family:var(--mono);font-weight:400;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);text-align:left;padding:10px 0;border-bottom:2px solid var(--ink)}
table.data td{padding:12px 12px 12px 0;border-bottom:1px solid var(--line);vertical-align:top}
table.data td.n{font-weight:800;font-size:22px;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.hash{font-family:var(--mono);font-size:11.5px;word-break:break-all;color:var(--ink-2)}
.ok{color:var(--ok);font-weight:600}.no{color:var(--bad);font-weight:600}
.big-note{font-size:17px;color:var(--ink-2);max-width:60ch}
textarea.box{min-height:96px;resize:vertical}
pre{background:var(--feed);color:#e9e6df;padding:20px;overflow:auto;font:13px/1.6 var(--mono)}
footer{border-top:1px solid var(--line);padding:22px 0 40px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}

@media (max-width:1100px){.hero{grid-template-columns:minmax(0,1fr)}.obs{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.rail{display:none}.records{grid-template-columns:1fr 1fr}.records .rec:nth-child(3){border-left:0;padding-left:0}.records .rec+.rec{border-left:0;padding-left:0;border-top:1px solid var(--line)}}
@media (max-width:760px){
 .nav{grid-template-columns:1fr auto;height:auto;padding:14px 0;row-gap:10px}.links{grid-column:1/-1;grid-row:2;gap:22px}.cta .btn{padding:10px 16px;font-size:14px}
 .hero,.obs,.grid2{grid-template-columns:minmax(0,1fr)}.records{grid-template-columns:1fr}.records .rec+.rec{border-left:0;padding-left:0;border-top:1px solid var(--line)}.tiles{gap:6px}
 .setup{grid-template-columns:1fr 1fr}.setup>div:last-child{grid-column:1/-1}
 .rec,.rows .rec{grid-template-columns:92px 1fr auto;gap:14px}.thumb{height:56px;font-size:20px}
 .feed:not(.photo){aspect-ratio:auto;min-height:240px;padding-top:44px}
 .display span{white-space:normal}
 .field input{font-size:16px}.go{width:60px}.log li{grid-template-columns:84px 1fr}
}
`;

const ARROW_UR = `<svg class="arrow" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 10 10 4M5 4h5v5"/></svg>`;
const ARROW_R = `<svg class="arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8h11M9 4l4 4-4 4"/></svg>`;

const LOGO = `<svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#0e0e0d"/>
<g stroke="#f2f0eb" stroke-width="1.5" stroke-linecap="round" fill="none"><path d="M16.00 11.00 L29.72 12.32"/><path d="M20.33 13.50 L26.04 26.04"/><path d="M20.33 18.50 L12.32 29.72"/><path d="M16.00 21.00 L2.28 19.68"/><path d="M11.67 18.50 L5.96 5.96"/><path d="M11.67 13.50 L19.68 2.28"/></g></svg>`;

type Nav = 'observe' | 'records' | 'developers' | null;

function layout(title: string, body: string, nav: Nav): string {
  const link = (href: string, label: string, key: Nav) => `<a href="${href}"${nav === key ? ' class="on" aria-current="page"' : ''}>${label}</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="preload" href="/fonts/InterTight.woff2" as="font" type="font/woff2" crossorigin>
<style>${FONT_FACES}${STYLE}</style></head><body>
<div class="wrap">
<header class="nav"><a class="brand" href="/">${LOGO}WITNESS</a>
<nav class="links">${link('/', 'Observe', 'observe')}${link('/records', 'Records', 'records')}${link('/developers', 'Developers', 'developers')}</nav>
<div class="cta"><a class="btn" href="/#observe">Launch app ${ARROW_UR}</a></div></header>
${body}
<footer><span class="mono">Witness · Watch it happen. Put it on record.</span><span class="mono">Recorded means published, not guaranteed true</span></footer>
</div></body></html>`;
}

function rail(...groups: string[][]): string {
  return `<aside class="rail" aria-hidden="true">${groups.map((g) => `<div class="mono">${g.join('<br>')}</div>`).join('')}</aside>`;
}

const STATUS_LABEL: Record<string, string> = {
  watching: 'Watching',
  result_detected: 'Result detected',
  inconclusive: 'Inconclusive',
  provisional: 'Provisional',
  recorded: 'Recorded',
  disputed: 'Disputed',
  corrected: 'Corrected',
};

const STATUS_TEXT: Record<RecordStatus, string> = {
  provisional: 'A result was detected but has not been published yet.',
  recorded: 'This report was published to the ledger. Recorded means published, not guaranteed true.',
  disputed: 'Someone has challenged this report. It stays visible while it is reviewed.',
  corrected: 'A later report supersedes this one. Both stay on the ledger.',
  inconclusive: 'The evidence cannot establish the result.',
};

function headline(r: WitnessRecord): string {
  const p = r.payload;
  if (p.winner === null) return 'No winner established.';
  const w = p.matches.filter((m) => m.winner === p.winner).length;
  const l = p.matches.filter((m) => m.winner === 1 - p.winner!).length;
  return p.format === 'bo3' ? `${p.participants[p.winner]} wins ${w}–${l}.` : `${p.participants[p.winner]} wins.`;
}

function recordRow(r: WitnessRecord): string {
  const p = r.payload;
  const last = p.matches.at(-1)!;
  const score = p.format === 'bo3' && p.winner !== null ? headline(r).replace(/^.* wins /, '').replace('.', '') : last.scores.join('–');
  return `<a class="rec" href="/r/${esc(r.id)}"><div class="thumb" style="background:url(/img/thumb-gaming.jpg)"><span style="text-shadow:0 1px 8px #000">${esc(score)}</span></div>
<div><div class="t">${esc(p.participants[0])} vs ${esc(p.participants[1])}</div><div class="s">${p.matches.map((m) => m.scores.join('–')).join(' · ')}</div>
<div class="m"><span class="dot d-${r.status}"></span>${esc(STATUS_LABEL[r.status])} · ${esc(ago(p.issuedAt))}</div></div>${ARROW_R}</a>`;
}

function feedPanel(s: Session, scores: [number, number] | null, sub: string): string {
  return `<div class="feed game"><div class="tag"><span class="dot${s.status === 'watching' ? ' live' : ''}"></span><span id="tag">${esc(s.participants[0])} vs ${esc(s.participants[1])} · ${s.status === 'watching' ? 'Live feed' : 'Ended'}</span></div>
<div class="board"><div class="names"><span>${esc(s.participants[0])}</span><span></span><span>${esc(s.participants[1])}</span></div>
<div class="nums" id="score">${scores ? `${scores[0]}<i>:</i>${scores[1]}` : '–<i>:</i>–'}</div><div class="sub" id="match">${esc(sub)}</div></div></div>`;
}

export type HomeData = {
  devMode: boolean;
  live: { session: Session; scores: [number, number] | null } | null;
  records: WitnessRecord[];
};

const EXAMPLES = [
  { thumb: 'thumb-soccer', title: 'School soccer', line: '3 – 2', drop: 2 },
  { thumb: 'thumb-concert', title: 'Concert stream', line: 'Event timeline', drop: 3 },
  { thumb: 'thumb-gaming', title: 'Gaming match', line: '13 – 9', drop: 1 },
  { thumb: 'thumb-station', title: 'Station feed', line: 'Arrival', drop: 4 },
];

function exampleRow(e: (typeof EXAMPLES)[number]): string {
  return `<div class="rec"><div class="thumb" style="background:url(/img/${e.thumb}.jpg)"></div>
<div><div class="t">${esc(e.title)}</div><div class="s">${esc(e.line)}</div><div class="m"><span class="dot" style="background:var(--line)"></span>Example</div></div><span></span></div>`;
}

export function homePage({ devMode, live, records }: HomeData): string {
  const watching = live && live.session.status === 'watching' ? live : null;
  const preview = watching
    ? `<div class="sec-head"><span class="mono">01 / Live observation</span><span class="watching"><span class="dot live"></span>Watching</span></div>
<section class="obs">${feedPanel(watching.session, watching.scores, watching.session.format === 'bo3' ? 'Best of three' : 'Single match')}
<div class="panel"><div class="panel-top"><span class="mono">Event detected</span><span class="mono">${esc(new Date(watching.session.createdAt).toLocaleTimeString('en-GB'))}</span></div>
<h2>Watching now</h2>
<table class="kv"><tr><td>Event</td><td>${watching.session.format === 'bo3' ? 'Best-of-three result' : 'Match result'}</td></tr>
<tr><td>Source</td><td>${watching.session.source.kind === 'simulated' ? 'Simulated feed' : 'Connected analyzer'}</td></tr>
<tr><td>Status</td><td><span class="dot"></span>Watching</td></tr></table>
<div class="actions"><a class="btn mono-btn" href="/s/${esc(watching.session.id)}">Open session ${ARROW_UR}</a></div></div>
${rail(['A live', 'world', 'a shared', 'record'], ['Turn', 'observation', 'into', 'public records'])}</section>`
    : `<div class="sec-head"><span class="mono">01 / Live observation</span><span class="watching"><span class="dot"></span>Watching</span></div>
<section class="obs"><div class="feed photo"><img src="/img/platform.jpg" alt="Platform camera: a train arriving at platform 2 as passengers wait" width="863" height="304"><span class="mono">Example observation · Transit feeds are on the roadmap; match tracking works today</span></div>
<div class="panel"><div class="panel-top"><span class="mono">Event detected</span><span class="mono">16:04:32</span></div>
<h2>Arrival detected</h2>
<table class="kv"><tr><td>Event</td><td>Train arrival</td></tr>
<tr><td>Source</td><td>Connected camera</td></tr>
<tr><td>Status</td><td><span class="dot"></span>Provisional</td></tr></table>
<div class="actions"><a class="btn mono-btn" href="#observe">View evidence ${ARROW_UR}</a></div></div>
${rail(['A live', 'world', 'a shared', 'record'], ['Turn', 'observation', 'into', 'public records'])}</section>`;

  const shown = records.slice(0, 4);
  // Real records first; examples fill the row, the gaming one making way first since real records are matches.
  const fill = EXAMPLES.filter((e) => e.drop > shown.length);
  const cards = [...shown.map(recordRow), ...fill.map(exampleRow)];

  return layout(
    'Witness',
    `<section class="hero" id="observe"><div>
<h1 class="display"><span>Reality,</span><br><span>on the record.</span></h1>
<p class="lede">Give AI a stream. Turn moments into public records.</p>
<form id="f" novalidate>
 <div class="field"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>
 <input id="link" type="url" placeholder="Paste a stream link" aria-label="Stream link" autocomplete="off">
 <button class="go" aria-label="Start observing" ${devMode ? '' : 'disabled'}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 10h13M11 5l5 5-5 5"/></svg></button></div>
 <label class="q" for="look">What should Witness look for?</label>
 <input class="box" id="look" maxlength="200" placeholder="Describe what to watch for…">
 <div class="examples"><span class="mono">Examples</span>
  <button type="button" class="chip" data-kind="match" data-ex="Track the score and report the winner.">A match winner</button>
  <button type="button" class="chip" data-kind="soon" data-ex="Log when the set starts, each song, and when it ends.">A live performance</button>
  <button type="button" class="chip" data-kind="soon" data-ex="Record each train arriving at platform 2.">A train arrival</button></div>
 <div id="more" hidden>
 <div class="setup">
  <div><span class="mono">Player 1</span><input class="box" id="p0" maxlength="32" value="Drew" aria-label="Player 1 alias"></div>
  <div><span class="mono">Player 2</span><input class="box" id="p1" maxlength="32" value="Alex" aria-label="Player 2 alias"></div>
  <div><span class="mono">Format</span><div class="seg" role="radiogroup" aria-label="Format">
   <label><input type="radio" name="fmt" value="bo3" checked>Best of 3</label><label><input type="radio" name="fmt" value="single">Single</label></div></div>
 </div>
 <label class="ack"><input type="checkbox" id="ack"><span>I understand the final result (these aliases, scores, winner and times) is published permanently and <b>cannot be deleted</b>. Use aliases, not real names or contact details.</span></label>
 <p class="note">Leave the link empty to watch the simulated demo feed. Direct stream links are coming with the first supported game.</p>
 </div>
 <p class="err" id="err" role="alert">${devMode ? '' : 'This server requires an API key. Start sessions through the API.'}</p>
</form></div>
<div class="tiles">
 <img src="/img/feed-transit.jpg" alt="Transit CCTV: a train arriving at a platform" width="353" height="195">
 <img src="/img/feed-concert.jpg" alt="Concert livestream: a band on a lit stage" width="376" height="195">
 <img src="/img/feed-gaming.jpg" alt="Gaming stream: first-person match with score HUD" width="353" height="232">
 <img src="/img/feed-soccer.jpg" alt="High school soccer: match in progress, 1–0" width="376" height="232">
 <span class="mono tiles-note">Example feeds</span>
</div>
</section>
${preview}
<div class="sec-head"><span class="mono">Recent records</span><a class="mono" href="/records" style="text-decoration:none">View all &nbsp;→</a></div>
<div class="records">${cards.join('')}</div>
<script>
const $ = (id) => document.getElementById(id);
let kind = null;
document.querySelectorAll('[data-ex]').forEach((b) => b.onclick = () => {
  document.querySelectorAll('[data-ex]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
  $('look').value = b.dataset.ex; kind = b.dataset.kind;
  $('err').textContent = kind === 'soon' ? 'Coming soon. Today Witness tracks match results; performances and transit are next.' : '';
});
$('look').addEventListener('input', () => { kind = null; document.querySelectorAll('[data-ex]').forEach((o) => o.setAttribute('aria-pressed', 'false')); $('err').textContent = ''; });
$('f').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const err = $('err');
  if ($('link').value.trim()) { err.textContent = "Stream links aren't supported yet. Leave the link empty to watch the demo feed."; return; }
  if (kind === 'soon') { err.textContent = 'Coming soon. Today Witness tracks match results; pick "A match winner".'; return; }
  if ($('more').hidden) { $('more').hidden = false; if (!$('look').value) $('look').value = 'Track the score and report the winner.'; $('p0').focus(); err.textContent = ''; return; }
  if (!$('ack').checked) { err.textContent = 'Please confirm you understand the result is published permanently.'; return; }
  err.textContent = '';
  const res = await fetch('/v1/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    game: 'generic-scoreboard', format: document.querySelector('input[name=fmt]:checked').value, participants: [$('p0').value, $('p1').value],
    source: { kind: 'simulated' }, instructions: $('look').value, acknowledgePublic: true }) });
  const out = await res.json();
  if (!res.ok) { err.textContent = out.error; return; }
  location.href = '/s/' + out.id;
});
</script>`,
    'observe',
  );
}

export function livePage(s: Session, devMode: boolean): string {
  return layout(
    `${s.participants.join(' vs ')} · Witness`,
    `<div style="padding-top:28px"></div>
<div class="sec-head"><span class="mono">01 / Live observation</span><span class="watching"><span class="dot live" id="sdot"></span><span id="status">${esc(STATUS_LABEL[s.status])}</span></span></div>
<div id="warn"></div>
<section class="obs">${feedPanel(s, null, 'Waiting for the scoreboard')}
<div class="panel"><div class="panel-top"><span class="mono" id="ekind">Event detected</span><span class="mono" id="etime">--:--:--</span></div>
<h2 id="ehead">Connecting…</h2>
<table class="kv"><tr><td>Event</td><td id="ev">—</td></tr>
<tr><td>Source</td><td>${s.source.kind === 'simulated' ? 'Simulated feed' : 'Connected analyzer'}</td></tr>
<tr><td>Status</td><td><span class="dot" id="kdot"></span><span id="kstatus">${esc(STATUS_LABEL[s.status])}</span></td></tr>
<tr><td>Evidence</td><td id="evq">Observed</td></tr></table>
<div class="actions" id="actions"></div>
<p class="note" id="pubnote" hidden>Check the result before publishing. Publishing is permanent.</p></div>
${rail(['A live', 'world', 'a shared', 'record'], ['Turn', 'observation', 'into', 'public records'])}</section>

<div class="sec-head"><span class="mono">02 / Event log</span><span class="mono">${s.instructions ? `Watching for: ${esc(s.instructions)}` : ''}</span></div>
<ul class="log" id="log"></ul>
${s.source.kind === 'push' ? `<p class="note">Waiting for readings at <code>POST /v1/sessions/${esc(s.id)}/readings</code>.</p>` : ''}
${devMode ? `<p style="margin:24px 0"><button class="btn ghost" id="stop">Stop observing</button></p>` : ''}
<script>
const S = ${scriptJson({ id: s.id, participants: s.participants, devMode })};
const LABEL = ${scriptJson(STATUS_LABEL)};
const $ = (id) => document.getElementById(id);
const UR = ${scriptJson(ARROW_UR)};
const wins = [0, 0];
const fmt = (t) => new Date(t).toLocaleTimeString('en-GB');
function describe(e) {
  const d = e.data, p = S.participants;
  switch (e.type) {
    case 'session.started': return ['Session started', 'Watching'];
    case 'match.started': return ['Match ' + d.match + ' started', 'Match start'];
    case 'score.updated': {
      const who = d.scores[0] > d.previous[0] ? p[0] : d.scores[1] > d.previous[1] ? p[1] : null;
      return [(who ? who + ' scored' : 'Score changed'), 'Score ' + d.scores.join('–')];
    }
    case 'match.result_detected': return [d.winner === null ? 'No winner' : p[d.winner] + ' takes match ' + d.match, 'Match ' + d.match + ' ended ' + d.scores.join('–')];
    case 'evidence.warning': return ['Evidence warning', d.message];
    case 'session.result_detected': return ['Result detected', p[d.winner] + ' wins ' + d.wins[d.winner] + '–' + d.wins[1 - d.winner]];
    case 'session.inconclusive': return ['Inconclusive', d.reason];
    case 'result.recorded': return ['On the record', 'Published to the ledger'];
    case 'result.disputed': return ['Disputed', 'Challenged by ' + d.by];
    case 'result.corrected': return ['Corrected', d.reason];
  }
  return [e.type, ''];
}
function setStatus(st) {
  $('status').textContent = LABEL[st] || st; $('kstatus').textContent = LABEL[st] || st;
  const cls = 'dot' + (st === 'watching' || st === 'provisional' ? '' : ' d-' + st);
  $('sdot').className = cls + (st === 'watching' ? ' live' : ''); $('kdot').className = cls;
  if (st !== 'watching') { $('tag').textContent = S.participants.join(' vs ') + ' · Ended'; document.querySelector('.tag .dot').className = 'dot ' + 'd-' + st; if ($('stop')) $('stop').hidden = true; }
}
async function showRecord() {
  const s = await (await fetch('/v1/sessions/' + S.id)).json();
  setStatus(s.status);
  if (!s.recordId) return;
  const { record: r } = await (await fetch('/v1/records/' + s.recordId)).json();
  setStatus(r.status);
  $('evq').textContent = r.evidence.quality[0].toUpperCase() + r.evidence.quality.slice(1) + ' · ' + Math.round(r.evidence.coverage * 100) + '% readable';
  const a = $('actions'); a.innerHTML = '';
  if (r.status === 'provisional' && S.devMode) {
    const b = document.createElement('button'); b.className = 'btn mono-btn'; b.innerHTML = 'Publish to the record ' + UR;
    b.onclick = async () => {
      b.disabled = true;
      const res = await fetch('/v1/records/' + r.id + '/publish', { method: 'POST' });
      if (res.ok) location.href = '/r/' + r.id; else { b.disabled = false; $('pubnote').textContent = (await res.json()).error; }
    };
    a.append(b); $('pubnote').hidden = false;
  }
  const v = document.createElement('a'); v.className = 'btn mono-btn' + (r.status === 'provisional' ? ' ghost' : ''); v.href = '/r/' + r.id; v.innerHTML = 'View evidence ' + UR;
  a.append(v);
}
const es = new EventSource('/v1/sessions/' + S.id + '/stream');
es.onmessage = (m) => {
  const e = JSON.parse(m.data), d = e.data;
  const [head, detail] = describe(e);
  $('ehead').textContent = head; $('ev').textContent = detail; $('etime').textContent = fmt(e.observedAt);
  $('ekind').textContent = e.type === 'evidence.warning' ? 'Evidence warning' : 'Event detected';
  const li = document.createElement('li');
  li.innerHTML = '<time></time><span></span>';
  li.firstChild.textContent = fmt(e.observedAt); li.lastChild.textContent = head + (detail && detail !== head ? ' — ' + detail : '');
  if (e.type === 'evidence.warning') li.lastChild.className = 'w';
  $('log').prepend(li);
  if (e.type === 'match.started' || e.type === 'score.updated' || e.type === 'match.result_detected') {
    $('score').innerHTML = d.scores[0] + '<i>:</i>' + d.scores[1];
    if (e.type === 'match.result_detected' && d.winner !== null) wins[d.winner]++;
    $('match').textContent = 'Match ' + d.match + ' · Wins ' + wins[0] + '–' + wins[1];
  }
  if (e.type === 'evidence.warning') { $('warn').innerHTML = '<div class="banner"><span class="dot"></span><span></span></div>'; $('warn').querySelector('span:last-child').textContent = d.message; }
  if (e.type === 'session.result_detected' || e.type === 'session.inconclusive' || e.type === 'result.recorded') showRecord();
};
const stop = $('stop');
if (stop) stop.onclick = async () => { stop.disabled = true; await fetch('/v1/sessions/' + S.id + '/stop', { method: 'POST' }); showRecord(); };
</script>`,
    'observe',
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
  const check = (ok: boolean) => (ok ? '<span class="ok">Pass</span>' : '<span class="no">Fail</span>');
  const canDispute = devMode && (latest.status === 'recorded' || latest.status === 'disputed' || latest.status === 'provisional');

  return layout(
    `${names.join(' vs ')} · Witness record`,
    `<div class="page">
${requestedId !== latest.id ? `<div class="banner"><span class="dot d-corrected"></span><span>You followed a link to an earlier version (${esc(requestedId)}). It has been corrected; the current report is shown.</span></div>` : ''}
<div class="meta"><span class="mono">Record ${esc(latest.id)}</span><span class="mono">${esc(p.game)}</span><span class="mono">${p.format === 'bo3' ? 'Best of three' : 'Single match'}</span><span class="mono">${esc(new Date(p.observedFrom).toUTCString().replace(' GMT', ' UTC'))}</span></div>
<h1 class="display">${esc(headline(latest))}</h1>
<div class="meta" style="align-items:center"><span style="font-size:20px">${esc(names[0])} vs ${esc(names[1])}</span>
<span class="pill"><span class="dot d-${latest.status}"></span>${esc(STATUS_LABEL[latest.status])}</span>
<span class="pill">Evidence: ${esc(latest.evidence.quality)}</span></div>
<p class="big-note">${esc(STATUS_TEXT[latest.status])}</p>

<div class="grid2" style="margin-top:36px">
<section class="block"><div class="sec-head"><span class="mono">01 / Result</span></div>
<table class="data"><tr><th>Match</th><th>${esc(names[0])}</th><th>${esc(names[1])}</th><th>Winner</th></tr>
${p.matches.map((m, i) => `<tr><td>${i + 1}</td><td class="n">${m.scores[0]}</td><td class="n">${m.scores[1]}</td><td>${m.winner === null ? '<span class="no">Not established</span>' : esc(names[m.winner])}</td></tr>`).join('')}
</table></section>

<section class="block"><div class="sec-head"><span class="mono">02 / Evidence</span></div>
<table class="kv"><tr><td>Methods</td><td>${latest.evidence.methods.map(esc).join(', ')}</td></tr>
<tr><td>Readable footage</td><td>${Math.round(latest.evidence.coverage * 100)}%</td></tr>
${latest.evidence.confirmedBy.length ? `<tr><td>Confirmed by</td><td>${latest.evidence.confirmedBy.map(esc).join(', ')}</td></tr>` : ''}
<tr><td>Warnings</td><td>${latest.evidence.warnings.length ? latest.evidence.warnings.map(esc).join('<br>') : 'None'}</td></tr>
${latest.correctionReason ? `<tr><td>Correction</td><td>${esc(latest.correctionReason)}</td></tr>` : ''}</table></section>

<section class="block"><div class="sec-head"><span class="mono">03 / Verification</span></div>
<table class="kv">
<tr><td>Issuer signature</td><td>${check(v.signatureValid)} <span class="hash">key ${esc(v.issuerKeyId)}</span></td></tr>
<tr><td>On the ledger</td><td>${latest.ledgerRef ? `${check(v.publishedOnLedger)} <span class="hash">${esc(latest.ledgerRef.network)} #${latest.ledgerRef.height}<br>${esc(latest.ledgerRef.txHash)}</span>` : 'Not yet published'}</td></tr>
<tr><td>Ledger matches report</td><td>${check(v.ledgerMatchesRecord)}</td></tr>
<tr><td>Evidence fingerprint</td><td>${check(v.evidenceMatchesFingerprint)} <span class="hash">${esc(p.evidenceFingerprint)}</span></td></tr></table>
<p class="note">These checks show the report hasn't been altered since publication. They don't show the footage was authentic or the AI was right.</p></section>

<section class="block"><div class="sec-head"><span class="mono">04 / History</span></div>
<table class="data"><tr><th>Version</th><th>Status</th><th>Scores</th><th></th></tr>
${history.map((r) => `<tr><td><a class="hash" href="/r/${esc(r.id)}">${esc(r.id)}</a></td><td><span class="dot d-${r.status}" style="width:8px;height:8px;margin-right:8px"></span>${esc(STATUS_LABEL[r.status])}</td><td>${r.payload.matches.map((m) => m.scores.join('–')).join(', ')}</td><td class="mono">${r.payload.supersedes ? 'Correction' : 'Original'}</td></tr>`).join('')}
</table>
${latest.disputes.length ? `<table class="kv" style="margin-top:20px">${latest.disputes.map((d) => `<tr><td>Dispute · ${esc(d.by)}</td><td>${esc(d.reason)}</td></tr>`).join('')}</table>` : ''}
</section>
</div>

${
  canDispute
    ? `<section class="block" style="max-width:640px"><div class="sec-head"><span class="mono">05 / Dispute this result</span></div>
<form id="d"><label class="q" for="by" style="margin-top:4px">Your alias</label><input class="box" id="by" maxlength="32">
<label class="q" for="reason">What's wrong?</label><textarea class="box" id="reason" maxlength="1000"></textarea>
<p style="margin-top:18px"><button class="btn mono-btn">Submit dispute ${ARROW_UR}</button></p><p class="err" id="err" role="alert"></p></form>
<script>
document.getElementById('d').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const res = await fetch('/v1/records/${esc(latest.id)}/disputes', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ by: document.getElementById('by').value, reason: document.getElementById('reason').value }) });
  if (res.ok) location.reload(); else document.getElementById('err').textContent = (await res.json()).error;
});
</script></section>`
    : ''
}
</div>`,
    'records',
  );
}

export function recordsPage(records: WitnessRecord[]): string {
  return layout(
    'Records · Witness',
    `<div class="page"><span class="mono">Public ledger</span><h1 class="display">Records.</h1>
<p class="big-note">Every published observation, latest version first. Corrections replace what's shown here; the originals stay in each record's history.</p>
<div class="sec-head" style="margin-top:28px"><span class="mono">${records.length} record${records.length === 1 ? '' : 's'}</span></div>
<div class="rows">${records.length ? records.map(recordRow).join('') : '<p class="note">Nothing published yet. <a href="/#observe">Observe a match</a>.</p>'}</div></div>`,
    'records',
  );
}

export function developersPage(): string {
  const rows: [string, string, string][] = [
    ['POST', '/v1/sessions', 'Create an observation session'],
    ['GET', '/v1/sessions/:id', 'Session status and live score'],
    ['GET', '/v1/sessions/:id/stream', 'Live events (server-sent events, resumable with Last-Event-ID)'],
    ['GET', '/v1/sessions/:id/events?after=N', 'Event log since version N'],
    ['POST', '/v1/sessions/:id/readings', 'Push analyzer readings'],
    ['POST', '/v1/sessions/:id/stop', 'Stop observing'],
    ['GET', '/v1/records/:id', 'Record and full revision history'],
    ['GET', '/v1/records/:id/verify', 'Signature, ledger and fingerprint checks'],
    ['POST', '/v1/records/:id/confirm', 'Participant confirmation'],
    ['POST', '/v1/records/:id/publish', 'Publish to the ledger (irreversible)'],
    ['POST', '/v1/records/:id/disputes', 'Dispute a result'],
    ['POST', '/v1/webhooks', 'Subscribe to events (HMAC-signed deliveries)'],
    ['GET', '/v1/issuer', 'Issuer public key for verifying signatures'],
  ];
  return layout(
    'Developers · Witness',
    `<div class="page"><span class="mono">API · v1</span><h1 class="display">Build on<br>the record.</h1>
<p class="big-note">Structured events from real matches, without building video analysis. Every event carries an ID, version, observation time and evidence status, so you can handle delays, duplicates and corrections.</p>
<div class="grid2" style="margin-top:36px">
<section class="block"><div class="sec-head"><span class="mono">01 / Endpoints</span></div>
<table class="data"><tr><th>Method</th><th>Path</th><th>Purpose</th></tr>
${rows.map(([m, p, d]) => `<tr><td class="mono" style="color:var(--ink)">${m}</td><td class="hash">${esc(p)}</td><td>${esc(d)}</td></tr>`).join('')}</table></section>
<section class="block"><div class="sec-head"><span class="mono">02 / Quick start</span></div>
<pre>curl -X POST $WITNESS/v1/sessions \\
  -H "authorization: Bearer $KEY" \\
  -H "content-type: application/json" \\
  -d '{"game":"generic-scoreboard","format":"bo3",
       "participants":["Drew","Alex"],
       "acknowledgePublic":true}'

curl -N $WITNESS/v1/sessions/$ID/stream</pre>
<div class="sec-head" style="margin-top:20px"><span class="mono">03 / Event types</span></div>
<p class="hash" style="line-height:2">session.started · match.started · score.updated · match.result_detected · evidence.warning · session.result_detected · session.inconclusive · result.recorded · result.disputed · result.corrected</p>
</section></div></div>`,
    'developers',
  );
}

export function notFoundPage(message: string): string {
  return layout('Witness', `<div class="page"><span class="mono">Not available</span><h1 class="display">Off the record.</h1><p class="big-note">${esc(message)}</p><p><a class="btn" href="/">Back to Witness ${ARROW_UR}</a></p></div>`, null);
}
