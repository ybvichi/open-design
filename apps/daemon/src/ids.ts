import { randomBytes, createHash } from 'node:crypto';
import { getSsoUser } from './sso-user.js';

// Lowercase alphanumeric alphabet, matching the Vela workspace ID format
 // (e.g. "tljbioajfmjv52wm1h86ybow"). 36 symbols → ~5.17 bits per character.
 const LOWERCASE_ALPHANUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
 
 /** Default length, matching Vela workspace/member IDs. */
 export const DEFAULT_SHORT_ID_LENGTH = 25;
 
 /**
  * Generate a short, URL-safe, lowercase-alphanumeric random ID.
  *
  * Uses `crypto.randomBytes` (not `Math.random`) for cryptographic strength.
  * The default length of 25 matches the Vela workspace/member ID format.
  *
  * @example generateShortId()   // "tljbioajfmjv52wm1h86ybow"
  * @example generateShortId(8)   // "a3k9x2qm"
  */
 export function generateShortId(length: number = DEFAULT_SHORT_ID_LENGTH): string {
   if (!Number.isInteger(length) || length <= 0) {
     throw new RangeError(`length must be a positive integer, got ${String(length)}`);
   }
  const bytes = randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += LOWERCASE_ALPHANUM.charAt(bytes.readUInt8(i) % LOWERCASE_ALPHANUM.length);
  }
  return result;
}

/**
 * Generate a short, lowercase-alphanumeric ID deterministically from a seed.
 *
 * Same seed always produces the same ID; different seeds produce different
 * IDs (as much as SHA-256 distribution allows). Useful when a stable,
 * reproducible ID is needed for a given input — e.g. deriving a workspace
 * or member ID from a username so the same user always maps to the same ID.
 *
 * @example generateDeterministicId('alice')   // always the same 25-char ID
 * @example generateDeterministicId('alice', 8) // always the same 8-char ID
 */
export function generateDeterministicId(
  seed: string,
  length: number = DEFAULT_SHORT_ID_LENGTH,
): string {
  if (!Number.isInteger(length) || length <= 0) {
    throw new RangeError(`length must be a positive integer, got ${String(length)}`);
  }
  const bytes = hashBytes(seed, length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += LOWERCASE_ALPHANUM.charAt(bytes[i]! % LOWERCASE_ALPHANUM.length);
  }
  return result;
}

/** Produce `length` deterministic bytes from `seed` via SHA-256 hash chaining. */
function hashBytes(seed: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  let input = seed;
  while (offset < length) {
    const digest = createHash('sha256').update(input).digest();
    const take = Math.min(digest.length, length - offset);
    out.set(digest.subarray(0, take), offset);
    offset += take;
    input = digest.toString('hex');
  }
  return out;
}

/**
 * Create a new team ID.
 *
 * When `seed` is provided, generates a deterministic ID from it so the same
 * seed always yields the same team ID. When omitted, falls back to a random
 * value + timestamp as the seed for `generateDeterministicId`.
 */
export function createTeamId(seed?: string): string {
  return generateDeterministicId(seed ?? generateShortId() + Date.now().toString(36));
}

let runtimeDataDir: string | undefined;

/** Set the daemon runtime data dir once at startup (called by server.ts). */
export function setRuntimeDataDir(dir: string): void {
  runtimeDataDir = dir;
}

/**
 * Derive the current account's team member ID from a team ID.
 *
 * The member ID is deterministically derived from `${teamId}_${username}`.
 * When `username` is provided it is used directly; otherwise the username
 * is resolved from the SSO session. Same team + account always yields the
 * same member ID.
 */
export function getTeamMemberId(teamId: string, username?: string): string {
  if (username === undefined) {
    const user = getSsoUser(runtimeDataDir);
    username = user?.username ?? '';
  }
  return generateDeterministicId(`${teamId}_${username}`);
}

/**
 * Get the current user's default team ID.
 *
 * Deterministic per account: the same user always gets the same default
 * team ID, derived from `default_team_${username}`.
 */
export function getDefaultTeamId(): string {
  const user = getSsoUser(runtimeDataDir);
  const username = user?.username ?? '';
  return createTeamId(`default_team_${username}`);
}

/**
 * Get the current user's test team ID.
 *
 * Deterministic per account: the same user always gets the same test
 * team ID, derived from `test_team_${username}`.
 */
export function getTestTeamId(): string {
  const user = getSsoUser(runtimeDataDir);
  const username = user?.username ?? '';
  return createTeamId(`test_team_${username}`);
}
