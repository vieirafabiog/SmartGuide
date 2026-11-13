import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ApiKeyScope } from '../db/schema/index.js';

export const API_KEY_TOKEN_PREFIX = 'sg_live_';
export const API_KEY_DISPLAY_PREFIX_LENGTH = 12;

export interface GeneratedApiKey {
  plaintextKey: string;
  keyPrefix: string;
  keyHash: string;
}

/**
 * Computes the SHA-256 hex digest of a plaintext API key for safe DB storage.
 */
export function hashApiKey(plaintextKey: string): string {
  return createHash('sha256').update(plaintextKey, 'utf8').digest('hex');
}

/**
 * Generates a 256-bit cryptographic API key (`sg_live_<64-hex>`),
 * returning the one-time plaintext key, 12-char display prefix, and SHA-256 hash.
 */
export function generateApiKey(): GeneratedApiKey {
  const tokenBytes = randomBytes(32).toString('hex');
  const plaintextKey = `${API_KEY_TOKEN_PREFIX}${tokenBytes}`;
  return {
    plaintextKey,
    keyPrefix: plaintextKey.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH),
    keyHash: hashApiKey(plaintextKey),
  };
}

/**
 * Verifies a plaintext API key against a stored SHA-256 hex digest in constant time.
 */
export function verifyApiKey(providedKey: string, storedHashHex: string): boolean {
  if (!providedKey || !providedKey.startsWith(API_KEY_TOKEN_PREFIX)) {
    return false;
  }
  if (!/^[a-f0-9]{64}$/i.test(storedHashHex)) {
    return false;
  }

  const candidateBuf = Buffer.from(hashApiKey(providedKey), 'hex');
  const storedBuf = Buffer.from(storedHashHex, 'hex');
  if (candidateBuf.length !== storedBuf.length) {
    return false;
  }

  return timingSafeEqual(candidateBuf, storedBuf);
}

/**
 * Checks whether an API key's granted scopes include the required scope.
 */
export function hasApiKeyScope(
  grantedScopes: readonly string[],
  requiredScope: ApiKeyScope,
): boolean {
  return grantedScopes.includes(requiredScope);
}

