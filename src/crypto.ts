import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

/** Deterministic JSON: object keys sorted, so the same data always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Fingerprint of an off-chain evidence bundle. A random salt is mixed in and
 * kept off-chain with the evidence, so a short, guessable bundle (e.g. a
 * score line) cannot be recovered from its public hash by brute force.
 */
export function fingerprintEvidence(evidence: unknown, salt: string): string {
  return sha256(`${salt}:${canonicalJson(evidence)}`);
}

export function newSalt(): string {
  return randomBytes(16).toString('hex');
}

export class Issuer {
  readonly publicKeyPem: string;
  readonly keyId: string;
  private privateKey: KeyObject;

  constructor(privateKeyPem?: string) {
    if (privateKeyPem) {
      this.privateKey = createPrivateKey(privateKeyPem);
    } else {
      this.privateKey = generateKeyPairSync('ed25519').privateKey;
    }
    this.publicKeyPem = createPublicKey(this.privateKey).export({ type: 'spki', format: 'pem' }).toString();
    this.keyId = sha256(this.publicKeyPem).slice(0, 16);
  }

  sign(payload: unknown): string {
    return sign(null, Buffer.from(canonicalJson(payload)), this.privateKey).toString('base64');
  }
}

export function verifySignature(payload: unknown, signature: string, publicKeyPem: string): boolean {
  try {
    return verify(null, Buffer.from(canonicalJson(payload)), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}
