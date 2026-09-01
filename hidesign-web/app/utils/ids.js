'use strict';

const { randomBytes, createHash } = require('node:crypto');

// Lowercase alphanumeric alphabet, matching the Vela workspace ID format
// (e.g. "tljbioajfmjv52wm1h86ybow"). 36 symbols -> ~5.17 bits per character.
const LOWERCASE_ALPHANUM = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Default length, matching Vela workspace/member IDs. */
const DEFAULT_SHORT_ID_LENGTH = 25;

/**
 * Generate a short, URL-safe, lowercase-alphanumeric random ID.
 * Uses crypto.randomBytes (not Math.random) for cryptographic strength.
 */
function generateShortId(length = DEFAULT_SHORT_ID_LENGTH) {
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
 * Same seed always produces the same ID; different seeds produce different
 * IDs (as much as SHA-256 distribution allows).
 */
function generateDeterministicId(seed, length = DEFAULT_SHORT_ID_LENGTH) {
  if (!Number.isInteger(length) || length <= 0) {
    throw new RangeError(`length must be a positive integer, got ${String(length)}`);
  }
  const bytes = hashBytes(seed, length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += LOWERCASE_ALPHANUM.charAt(bytes[i] % LOWERCASE_ALPHANUM.length);
  }
  return result;
}

/** Produce `length` deterministic bytes from `seed` via SHA-256 hash chaining. */
function hashBytes(seed, length) {
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
 * When `seed` is provided, generates a deterministic ID from it so the same
 * seed always yields the same team ID. When omitted, falls back to a random
 * value + timestamp as the seed.
 */
function createTeamId(seed) {
  return generateDeterministicId(seed ?? generateShortId() + Date.now().toString(36));
}

/**
 * Derive a team member ID from a team ID + username.
 * The member ID is deterministically derived from `${teamId}_${username}`.
 * Same team + username always yields the same member ID.
 */
function getTeamMemberId(teamId, username) {
  return generateDeterministicId(`${teamId}_${username}`);
}

/**
 * Create a new folder ID.
 * When `seed` is provided, generates a deterministic ID from it so the same
 * seed always yields the same folder ID. When omitted, falls back to a random
 * value + timestamp as the seed.
 */
function createFolderId(seed) {
  return generateDeterministicId(seed ?? generateShortId() + Date.now().toString(36));
}

module.exports = {
  DEFAULT_SHORT_ID_LENGTH,
  generateShortId,
  generateDeterministicId,
  createTeamId,
  getTeamMemberId,
  createFolderId,
};
