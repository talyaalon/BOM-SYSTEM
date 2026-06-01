/**
 * utils/password.js
 *
 * Local password hashing using Node's built-in crypto.scrypt — no
 * external dependency (avoids bcrypt's native-build step on Render).
 *
 * Stored format:  scrypt$<saltHex>$<hashHex>
 *   • salt: 16 random bytes
 *   • hash: 64-byte scrypt derivation of the password
 *
 * verifyPassword uses a constant-time comparison so a wrong password
 * cannot be distinguished by timing.
 */

const crypto = require('crypto');

const SCHEME   = 'scrypt';
const KEYLEN   = 64;
const SALT_LEN = 16;

/**
 * Hash a plaintext password.  Returns the encoded string to store in
 * users.password_hash.
 * @param {string} plain
 * @returns {string}
 */
function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('Password must be a non-empty string');
  }
  const salt = crypto.randomBytes(SALT_LEN);
  const hash = crypto.scryptSync(plain, salt, KEYLEN);
  return `${SCHEME}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/**
 * Verify a plaintext password against a stored hash.  Returns false
 * (never throws) for any malformed / null stored value so callers can
 * treat it as a simple boolean gate.
 * @param {string} plain
 * @param {string|null|undefined} stored
 * @returns {boolean}
 */
function verifyPassword(plain, stored) {
  if (typeof plain !== 'string' || typeof stored !== 'string') return false;

  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== SCHEME) return false;

  const [, saltHex, hashHex] = parts;
  let salt, expected;
  try {
    salt     = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== KEYLEN) return false;

  const actual = crypto.scryptSync(plain, salt, KEYLEN);
  // timingSafeEqual requires equal-length buffers (guaranteed above).
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword };
