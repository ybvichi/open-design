import { randomBytes, createHash } from 'node:crypto';
 
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
