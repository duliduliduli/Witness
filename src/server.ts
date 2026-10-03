import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { homePage, livePage, notFoundPage, recordPage } from './pages.ts';
import { sampleSeries, simulate } from './simulator.ts';
import { Witness, WitnessError } from './service.ts';

export type ServerOptions = {
  /** Required for write calls when set. Unset = open development mode. */
  apiKey?: string;
  /** Required for corrections (human review). */
  adminKey?: string;
  /** Speed-up factor for simulated sources. */
  simSpeed?: number;
};

type Handler = (req: IncomingMessage, res: ServerResponse, params: string[], body: any) => Promise<unknown> | unknown;
type Route = { method: string; pattern: RegExp; auth: 'none' | 'api' | 'admin'; handler: Handler };

const MAX_BODY = 1_000_000;

function keyMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new WitnessError(413, 'Body too large.');
    chunks.push(c as Buffer);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new WitnessError(400, 'Body must be JSON.');
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data, null, 2));
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
  });
  res.end(html);
}

export function createWitnessServer(w: Witness, opts: ServerOptions = {}): Server {
  const simSpeed = opts.simSpeed ?? 10;

  const startSimulation = (sessionId: string) => {
    const frameMs = Math.max(5, Math.round(500 / simSpeed));
    const readings = simulate(sampleSeries(), { frameMs, start: Date.now(), dropRate: 0.04, misreadRate: 0.04, seed: Date.now() });
    let i = 0;
    const timer = setInterval(async () => {
      try {
        const s = await w.ingest(sessionId, [readings[i++]]);
        if (s.status !== 'watching' || i >= readings.length) {
          clearInterval(timer);
          if (s.status === 'watching') await w.stop(sessionId, 'Simulated stream ended');
        }
      } catch {
        clearInterval(timer);
      }
    }, frameMs);
    timer.unref();
  };

  const routes: Route[] = [
    // pages
    { method: 'GET', pattern: /^\/$/, auth: 'none', handler: (_q, res) => sendHtml(res, 200, homePage(!opts.apiKey)) },
    {
      method: 'GET',
      pattern: /^\/s\/([\w-]+)$/,
      auth: 'none',
      handler: (_q, res, [id]) => sendHtml(res, 200, livePage(w.getSession(id), !opts.apiKey)),
    },
    {
      method: 'GET',
      pattern: /^\/r\/([\w-]+)$/,
      auth: 'none',
      handler: async (_q, res, [id]) => {
        const history = w.history(id);
        sendHtml(res, 200, recordPage(id, history, await w.verify(history.at(-1)!.id), !opts.apiKey));
      },
    },

    // API
    { method: 'GET', pattern: /^\/v1\/issuer$/, auth: 'none', handler: () => ({ keyId: w.issuer.keyId, publicKey: w.issuer.publicKeyPem }) },
    {
      method: 'POST',
      pattern: /^\/v1\/sessions$/,
      auth: 'api',
      handler: (_q, res, _p, body) => {
        const s = w.createSession(body ?? {});
        if (s.source.kind === 'simulated') startSimulation(s.id);
        sendJson(res, 201, s);
      },
    },
    { method: 'GET', pattern: /^\/v1\/sessions\/([\w-]+)$/, auth: 'none', handler: (_q, _r, [id]) => ({ ...w.getSession(id), live: w.liveState(id) }) },
    {
      method: 'GET',
      pattern: /^\/v1\/sessions\/([\w-]+)\/events$/,
      auth: 'none',
      handler: (req, _r, [id]) => {
        const after = Number(new URL(req.url!, 'http://x').searchParams.get('after') ?? 0);
        return { events: w.getSession(id).events.filter((e) => e.version > after) };
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/sessions\/([\w-]+)\/stream$/,
      auth: 'none',
      handler: (req, res, [id]) => {
        const session = w.getSession(id);
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        // Replay from Last-Event-ID so reconnecting clients miss nothing.
        const lastSeen = Number(req.headers['last-event-id'] ?? 0);
        for (const e of session.events) if (e.version > lastSeen) res.write(`id: ${e.version}\ndata: ${JSON.stringify(e)}\n\n`);
        const off = w.subscribe(id, (e) => res.write(`id: ${e.version}\ndata: ${JSON.stringify(e)}\n\n`));
        const ping = setInterval(() => res.write(': ping\n\n'), 15000);
        req.on('close', () => {
          off();
          clearInterval(ping);
        });
      },
    },
    { method: 'POST', pattern: /^\/v1\/sessions\/([\w-]+)\/readings$/, auth: 'api', handler: (_q, _r, [id], b) => w.ingest(id, b?.readings) },
    { method: 'POST', pattern: /^\/v1\/sessions\/([\w-]+)\/stop$/, auth: 'api', handler: (_q, _r, [id]) => w.stop(id) },
    { method: 'GET', pattern: /^\/v1\/records\/([\w-]+)$/, auth: 'none', handler: (_q, _r, [id]) => ({ record: w.getRecord(id), history: w.history(id) }) },
    { method: 'GET', pattern: /^\/v1\/records\/([\w-]+)\/verify$/, auth: 'none', handler: (_q, _r, [id]) => w.verify(id) },
    { method: 'POST', pattern: /^\/v1\/records\/([\w-]+)\/confirm$/, auth: 'api', handler: (_q, _r, [id], b) => w.confirm(id, b?.participant) },
    { method: 'POST', pattern: /^\/v1\/records\/([\w-]+)\/publish$/, auth: 'api', handler: (_q, _r, [id]) => w.publish(id) },
    { method: 'POST', pattern: /^\/v1\/records\/([\w-]+)\/disputes$/, auth: 'api', handler: (_q, _r, [id], b) => w.dispute(id, b?.by, b?.reason) },
    { method: 'POST', pattern: /^\/v1\/records\/([\w-]+)\/corrections$/, auth: 'admin', handler: (_q, _r, [id], b) => w.correct(id, b ?? {}) },
    {
      method: 'POST',
      pattern: /^\/v1\/webhooks$/,
      auth: 'api',
      handler: (_q, res, _p, b) => sendJson(res, 201, w.addWebhook(b?.url, b?.events)),
    },
    {
      method: 'DELETE',
      pattern: /^\/v1\/webhooks\/([\w-]+)$/,
      auth: 'api',
      handler: (_q, res, [id]) => {
        w.removeWebhook(id);
        res.writeHead(204).end();
      },
    },
  ];

  return createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    try {
      let matchedPath = false;
      for (const r of routes) {
        const m = r.pattern.exec(path);
        if (!m) continue;
        matchedPath = true;
        if (r.method !== req.method) continue;
        const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
        if (r.auth === 'admin' && !(opts.adminKey && keyMatches(bearer, opts.adminKey))) {
          throw new WitnessError(opts.adminKey ? 401 : 403, opts.adminKey ? 'Admin key required.' : 'Corrections are disabled: set WITNESS_ADMIN_KEY.');
        }
        if (r.auth === 'api' && opts.apiKey && !keyMatches(bearer, opts.apiKey)) throw new WitnessError(401, 'API key required.');
        const body = await readBody(req);
        const out = await r.handler(req, res, m.slice(1), body);
        if (!res.headersSent && out !== undefined) sendJson(res, 200, out);
        return;
      }
      throw new WitnessError(matchedPath ? 405 : 404, matchedPath ? 'Method not allowed.' : 'Not found.');
    } catch (err) {
      if (res.headersSent) return res.end();
      const status = err instanceof WitnessError ? err.status : 500;
      const message = err instanceof WitnessError ? err.message : 'Internal error.';
      if (status === 500) console.error(err);
      if (path.startsWith('/v1/')) sendJson(res, status, { error: message });
      else sendHtml(res, status, notFoundPage(message));
    }
  });
}
