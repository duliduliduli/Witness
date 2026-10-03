import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { canonicalJson, sha256 } from './crypto.ts';
import type { LedgerRef } from './types.ts';

export type LedgerEntry = {
  height: number;
  prevHash: string;
  timestamp: number;
  payload: unknown;
  signature: string;
  hash: string;
};

/**
 * Where finalized records are published. The network is chosen after
 * measuring fees and confirmation behaviour; until then LocalLedger stands in.
 */
export interface Publisher {
  readonly network: string;
  publish(payload: unknown, signature: string): Promise<LedgerRef>;
  get(ref: LedgerRef): Promise<LedgerEntry | null>;
}

const GENESIS = '0'.repeat(64);

function entryHash(e: Omit<LedgerEntry, 'hash'>): string {
  return sha256(canonicalJson(e));
}

/** Append-only, hash-chained log. Optionally persisted as JSON lines. */
export class LocalLedger implements Publisher {
  readonly network = 'witness-local';
  private entries: LedgerEntry[] = [];
  private file: string | null;
  /** Test hook: make the next N publishes fail, to exercise retry paths. */
  failNext = 0;

  constructor(file: string | null = null) {
    this.file = file;
    if (file && existsSync(file)) {
      this.entries = readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as LedgerEntry);
      const bad = this.verifyChain();
      if (bad !== null) throw new Error(`Ledger file is corrupt at height ${bad}`);
    }
  }

  async publish(payload: unknown, signature: string): Promise<LedgerRef> {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('Ledger unavailable');
    }
    const prev = this.entries.at(-1);
    const base = {
      height: this.entries.length,
      prevHash: prev ? prev.hash : GENESIS,
      timestamp: Date.now(),
      payload,
      signature,
    };
    const entry: LedgerEntry = { ...base, hash: entryHash(base) };
    this.entries.push(entry);
    if (this.file) appendFileSync(this.file, JSON.stringify(entry) + '\n');
    return { network: this.network, height: entry.height, txHash: entry.hash };
  }

  async get(ref: LedgerRef): Promise<LedgerEntry | null> {
    const e = this.entries[ref.height];
    return e && e.hash === ref.txHash ? e : null;
  }

  /** Returns the first height that fails verification, or null if the chain is intact. */
  verifyChain(): number | null {
    let prev = GENESIS;
    for (const e of this.entries) {
      const { hash, ...base } = e;
      if (e.prevHash !== prev || entryHash(base) !== hash) return e.height;
      prev = hash;
    }
    return null;
  }

  get size(): number {
    return this.entries.length;
  }
}
