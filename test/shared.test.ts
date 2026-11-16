import { describe, expect, test } from 'bun:test'
import { hashPassword, NO_SUCH_USER_HASH, verifyPassword } from '../server/utils/password'
import {
  fromBase64,
  fromHex,
  generateSecret,
  openSecret,
  randomBytes,
  sealSecret,
  secretFingerprint,
  signAlert,
  toBase64,
  toBase64Url,
  toHex,
  utf8,
  verifyAlert,
} from '../shared/crypto'
import { isInstanceName, matchesInstance, parsePatterns } from '../shared/instances'

describe('signature', () => {
  // The same vector httpdog tests its own signing with (src/notify.rs), computed there with Python:
  //   hmac.new(b"s3cr3t", b'1794416274.{"text":"hi"}', hashlib.sha256).hexdigest()
  const body = utf8('{"text":"hi"}')
  const expected = '1728aa567d7ef419cab2bf10fd5e1c764cdb608bd22d6f4d051b2043db19b8fe'

  test('matches httpdog', async () => {
    expect(await signAlert('s3cr3t', 1_794_416_274, body)).toBe(expected)
    expect((await signAlert('s3cr3t', 1_794_416_275, body)).startsWith('e5faade226e917e9')).toBe(true)
  })

  test('verifies only the exact timestamp, body and secret', async () => {
    expect(await verifyAlert('s3cr3t', '1794416274', body, expected)).toBe(true)
    expect(await verifyAlert('s3cr3t', '1794416275', body, expected)).toBe(false)
    expect(await verifyAlert('s3cr3t', '1794416274', utf8('{"text":"hi!"}'), expected)).toBe(false)
    expect(await verifyAlert('other', '1794416274', body, expected)).toBe(false)
  })

  test('a malformed signature is simply not valid', async () => {
    expect(await verifyAlert('s3cr3t', '1794416274', body, 'zz')).toBe(false)
    expect(await verifyAlert('s3cr3t', '1794416274', body, expected.slice(0, 62))).toBe(false)
    expect(await verifyAlert('s3cr3t', '1794416274', body, '')).toBe(false)
  })
})

describe('encoding', () => {
  test('hex and base64 round trip', () => {
    const bytes = randomBytes(33)
    expect(fromHex(toHex(bytes))).toEqual(bytes)
    expect(fromBase64(toBase64(bytes))).toEqual(bytes)
    expect(fromHex('abc')).toBeNull()
    expect(fromHex('zz')).toBeNull()
    expect(fromBase64('not base64!')).toBeNull()
    expect(toBase64Url(new Uint8Array([251, 255, 254]))).toBe('-__-')
  })
})

describe('sealed secrets', () => {
  const key = toBase64(randomBytes(32))

  test('round trip, and a different nonce every time', async () => {
    const secret = generateSecret()
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
    const a = await sealSecret(key, secret)
    const b = await sealSecret(key, secret)
    expect(a).not.toBe(b)
    expect(a.startsWith('v1.')).toBe(true)
    expect(a).not.toContain(secret)
    expect(await openSecret(key, a)).toBe(secret)
    expect(await openSecret(key, b)).toBe(secret)
  })

  test('another key or a changed value does not open', async () => {
    const sealed = await sealSecret(key, 'the secret')
    expect(openSecret(toBase64(randomBytes(32)), sealed)).rejects.toThrow('SECRETS_KEY is not the one')
    const [version, nonce, data] = sealed.split('.')
    const flipped = `${version}.${nonce}.${data![0] === 'A' ? 'B' : 'A'}${data!.slice(1)}`
    expect(openSecret(key, flipped)).rejects.toThrow()
    expect(openSecret(key, 'plain text')).rejects.toThrow('not a sealed secret')
  })

  test('SECRETS_KEY must be 32 bytes', async () => {
    expect(sealSecret(undefined, 'x')).rejects.toThrow('SECRETS_KEY must be')
    expect(sealSecret('', 'x')).rejects.toThrow('SECRETS_KEY must be')
    expect(sealSecret(toBase64(randomBytes(16)), 'x')).rejects.toThrow('SECRETS_KEY must be')
  })

  test('fingerprint is the start of SHA-256', async () => {
    // printf %s abc | shasum -a 256
    expect(await secretFingerprint('abc')).toBe('ba7816bf')
  })
})

describe('instance patterns', () => {
  test('a name without * matches only itself', () => {
    expect(matchesInstance('web-01', 'web-01')).toBe(true)
    expect(matchesInstance('web-01', 'web-011')).toBe(false)
    expect(matchesInstance('web-01', 'WEB-01')).toBe(false)
  })

  test('* stands for any run of characters', () => {
    expect(matchesInstance('*', 'anything')).toBe(true)
    expect(matchesInstance('web-*', 'web-01')).toBe(true)
    expect(matchesInstance('web-*', 'web-')).toBe(true)
    expect(matchesInstance('web-*', 'db-01')).toBe(false)
    expect(matchesInstance('*-prod', 'web-prod')).toBe(true)
    expect(matchesInstance('*-prod', 'web-prod-2')).toBe(false)
    expect(matchesInstance('web-*-tw', 'web-01-tw')).toBe(true)
    expect(matchesInstance('web-*-tw', 'web-tw')).toBe(false)
    expect(matchesInstance('a*a', 'a')).toBe(false)
    expect(matchesInstance('a*b*c', 'a-b-c')).toBe(true)
    expect(matchesInstance('a*b*c', 'acb')).toBe(false)
    // every other character is literal, including the ones a regular expression would treat specially
    expect(matchesInstance('web.01', 'webx01')).toBe(false)
    expect(matchesInstance('(a|b)+', 'a')).toBe(false)
  })

  test('instance names follow httpdog: 1 to 64 characters, no control characters', () => {
    expect(isInstanceName('web-01')).toBe(true)
    expect(isInstanceName('zürich-web-01')).toBe(true)
    expect(isInstanceName('x'.repeat(64))).toBe(true)
    expect(isInstanceName('x'.repeat(65))).toBe(false)
    expect(isInstanceName('')).toBe(false)
    expect(isInstanceName('a\nb')).toBe(false)
    expect(isInstanceName('a\u0085b')).toBe(false)
    expect(isInstanceName(42)).toBe(false)
    expect(isInstanceName(null)).toBe(false)
  })

  test('typed lists are split on lines and commas', () => {
    expect(parsePatterns('web-01, web-02\n\n  db-*  \nweb-01')).toEqual(['web-01', 'web-02', 'db-*'])
    expect(parsePatterns('  ')).toEqual([])
  })
})

describe('passwords', () => {
  test('hash and verify', async () => {
    const hash = await hashPassword('correct horse battery')
    expect(hash).toMatch(/^pbkdf2-sha256\$100000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
    expect(await hashPassword('correct horse battery')).not.toBe(hash)
    expect(await verifyPassword('correct horse battery', hash)).toBe(true)
    expect(await verifyPassword('correct horse batterx', hash)).toBe(false)
    expect(await verifyPassword('', hash)).toBe(false)
  })

  test('nothing matches a malformed hash or the placeholder', async () => {
    expect(await verifyPassword('x', '')).toBe(false)
    expect(await verifyPassword('x', 'plain')).toBe(false)
    expect(await verifyPassword('x', 'pbkdf2-sha256$999999999$AAAA$AAAA')).toBe(false)
    expect(await verifyPassword('', NO_SUCH_USER_HASH)).toBe(false)
    expect(await verifyPassword('password', NO_SUCH_USER_HASH)).toBe(false)
  })
})
