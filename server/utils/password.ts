// Password hashing for the UI's own accounts: PBKDF2-HMAC-SHA256 through Web Crypto.
//
// Why PBKDF2 and why this count: the Workers runtime has no scrypt or argon2 that fits a request's
// CPU budget, and it refuses PBKDF2 with more than 100,000 iterations. The count is written into
// each hash, so it can be raised later without breaking the passwords already stored.
//
// No Nuxt or Nitro imports here: scripts/create-admin.ts and the tests use this file too.

import { fromBase64, randomBytes, sameBytes, toBase64, utf8 } from '../../shared/crypto'

const SCHEME = 'pbkdf2-sha256'
/** The most the Workers runtime allows */
const ITERATIONS = 100_000
const SALT_BYTES = 16
const HASH_BYTES = 32

export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 200

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, HASH_BYTES * 8)
  return new Uint8Array(bits)
}

/** "pbkdf2-sha256$<iterations>$<base64 salt>$<base64 hash>" */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const hash = await derive(password, salt, ITERATIONS)
  return `${SCHEME}$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, count, saltText, hashText] = stored.split('$')
  const iterations = Number(count)
  const salt = fromBase64(saltText ?? '')
  const expected = fromBase64(hashText ?? '')
  if (scheme !== SCHEME || !Number.isInteger(iterations) || iterations < 1 || iterations > ITERATIONS || !salt || !expected) {
    return false
  }
  return sameBytes(await derive(password, salt, iterations), expected)
}

/**
 * A well-formed hash that no password matches. Checking a login for a name that does not exist
 * against it takes as long as a real check, so the time taken does not reveal which names exist.
 */
export const NO_SUCH_USER_HASH = `${SCHEME}$${ITERATIONS}$${toBase64(new Uint8Array(SALT_BYTES))}$${toBase64(new Uint8Array(HASH_BYTES))}`

/** Lower case, starts with a letter or digit, then letters, digits, dot, dash or underscore: 1 to 32 in all */
export const USERNAME = /^[a-z0-9][a-z0-9._-]{0,31}$/
