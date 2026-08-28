 import { randomBytes } from 'node:crypto';
 
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
