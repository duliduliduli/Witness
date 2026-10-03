# Witness

**Watch it happen. Put it on record.**

Witness watches a supported match, tracks the score, and publishes the result as a signed, verifiable public record. It doesn't claim the AI is infallible. It keeps what it observed, how sure it was, and every correction.

## Run it

Requires Node 22.18+ (runs TypeScript directly; there's no build step and there are no runtime dependencies).

```sh
npm start        # http://localhost:3000 — start a simulated best-of-three from the home page
npm run demo     # terminal walkthrough: observe → detect → publish → verify → dispute → correct
npm test         # 22 tests
npm install && npm run typecheck
```

| Env var | Purpose |
| --- | --- |
| `PORT` | HTTP port (default 3000) |
| `WITNESS_API_KEY` | Required bearer token for write calls. Unset = open dev mode. |
| `WITNESS_ADMIN_KEY` | Required for corrections (human review). Unset = corrections disabled. |
| `WITNESS_ISSUER_KEY` | Ed25519 private key (PEM) used to sign records. Unset = throwaway key per run. |
| `WITNESS_LEDGER_FILE` | Persist the local ledger as JSON lines. |
| `WITNESS_SIM_SPEED` | Speed-up for simulated streams (default 10×). |

## How it works

```
video ──► analyzer ──► FrameReading[] ──► MatchTracker ──► events (SSE, webhooks)
          (per game)    {t, readable,       debounces,            │
                         scores, screen}    flags gaps,           ▼
                                            refuses to guess   provisional record
                                                                   │  review / confirm
                                                                   ▼
                                               signed payload ──► ledger (append-only)
                                               evidence bundle ─► off-chain, salted fingerprint on-chain
```

| File | Role |
| --- | --- |
| `src/tracker.ts` | Turns noisy scoreboard readings into a match timeline. A change must be seen in N consecutive frames. Unreadable stretches, gaps, score regressions, late joins and low coverage become warnings. Below 50% coverage it won't name a winner. |
| `src/service.ts` | Sessions, event log, records, publish (with retry), participant confirmation, disputes, append-only corrections, verification, signed webhooks. |
| `src/crypto.ts` | Canonical JSON, Ed25519 issuer signatures, salted evidence fingerprints. The salt stops a guessable score line from being recovered from its public hash. |
| `src/ledger.ts` | `Publisher` interface plus `LocalLedger`, a hash-chained append-only log that stands in for a blockchain. |
| `src/server.ts`, `src/pages.ts` | HTTP API, live SSE feed, and the pages: Observe (home), live session, public record, Records, Developers. Fonts: Inter Tight + JetBrains Mono from Google Fonts. |
| `src/simulator.ts` | Stand-in analyzer: realistic readings with dropped and misread frames. |

**Record lifecycle:** `provisional` → `recorded` (published) → `disputed` → `corrected` (superseded by a new ledger entry; the original stays). `inconclusive` sessions produce no record. Evidence quality (`high` / `reduced` / `insufficient`) is tracked separately from status, because "recorded" means *published*, not *true*.

**On-chain payload** (nothing else is published): record ID, schema version, game, format, aliases, per-match scores and winners, series winner, observation window, evidence fingerprint, `supersedes`, issue time. No stream URLs, accounts, footage or diagnostics.

## API

All write calls take `Authorization: Bearer $WITNESS_API_KEY` when a key is configured.

| Method | Path | |
| --- | --- | --- |
| POST | `/v1/sessions` | `{game, format: "single"\|"bo3", participants: [a, b], acknowledgePublic: true, source: {kind: "push"\|"simulated"}, autoPublish?}` |
| GET | `/v1/sessions/:id` | Session plus live score |
| GET | `/v1/sessions/:id/events?after=N` | Event log (each event: `id`, `version`, `emittedAt`, `observedAt`, `evidenceStatus`) |
| GET | `/v1/sessions/:id/stream` | Server-sent events; honours `Last-Event-ID` |
| POST | `/v1/sessions/:id/readings` | `{readings: FrameReading[]}` from an analyzer |
| POST | `/v1/sessions/:id/stop` | Stop observing (undecided → inconclusive) |
| GET | `/v1/records/:id` | Record plus full revision history |
| GET | `/v1/records/:id/verify` | Signature, ledger and fingerprint checks |
| POST | `/v1/records/:id/confirm` | `{participant}`; both confirm → `participant-confirmed` |
| POST | `/v1/records/:id/publish` | Irreversible. Writes to the ledger. |
| POST | `/v1/records/:id/disputes` | `{by, reason}` |
| POST | `/v1/records/:id/corrections` | Admin key. `{reviewer, reason, matches: [{scores}]}` |
| POST / DELETE | `/v1/webhooks`, `/v1/webhooks/:id` | `{url, events?}`; deliveries are signed `x-witness-signature: sha256=<hmac>` |
| GET | `/v1/issuer` | Issuer public key |

## What's real vs. stand-in

Real: tracking logic, evidence handling, signing, hash-chained ledger, record lifecycle, API, live page, public record page, webhooks.

Stand-ins, each behind an interface:

1. **Video analyzer.** `simulator.ts` produces the `FrameReading`s a game-specific detector would. The next step is to pick the first game (clear scoreboard, unambiguous end screen, permissive terms), label footage, and build a detector that emits `FrameReading`s. The tracker doesn't need to change.
2. **Stream ingest.** Authorized direct streaming (e.g. RTMP/WHIP into ffmpeg, then sampled frames into the analyzer).
3. **Blockchain.** Implement `Publisher` for the chosen network once fees and confirmation times are measured.
4. **Storage and accounts.** Sessions and records are in memory (only the ledger can persist). Next: a database, user accounts, per-developer API keys, source-ownership verification, retention limits and deletion.

## Before launch

Have California privacy/media counsel review: source authorization, publisher terms for the first game, the public-record acknowledgment, rules for minors, and anything touching wagers or prizes.
