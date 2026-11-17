// Fuzzing, as property tests. Each test states something that must hold for every input, and
// fast-check looks for an input that breaks it; when it finds one, it shrinks it to the smallest
// input that still does, and prints the seed to run exactly that again.
//
//   bun test                                       with the rest of the tests, FUZZ_RUNS inputs each (default 200)
//   make fuzz                                      many more inputs: FUZZ_RUNS=20000 by default
//   FUZZ_SEED=<seed> bun test test/fuzz.test.ts    replay what a failure printed
//
// What is fuzzed is what takes input nobody here wrote: the receiver (anyone can POST to it), the
// signature and encryption helpers under it, instance patterns, and the text of access logs on its
// way to a page.

import { beforeAll, describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { highlight, type Lang } from '../app/lib/highlight'
import { printable } from '../app/lib/format'
import { BUCKET_SIZE, bucket, type Env, handleRequest } from '../ingest/src/receiver'
import { parseEnv } from '../scripts/deploy-config'
import { setEnvValue } from '../scripts/setup'
import { fromBase64, fromHex, openSecret, randomBytes, sealSecret, secretFingerprint, signAlert, toBase64, toHex, utf8, verifyAlert } from '../shared/crypto'
import { isInstanceName, matchesInstance, parsePatterns } from '../shared/instances'
import { createTestDb } from './d1'

const seed = Number(process.env.FUZZ_SEED)
fc.configureGlobal({ numRuns: Number(process.env.FUZZ_RUNS) || 200, ...(Number.isFinite(seed) ? { seed } : {}) })

// ---------------------------------------------------------------- inputs

/** Characters that tend to be handled wrong: controls, marks that reverse text, separators, halves of a pair */
const TROUBLE = [
  '\u0000', '\t', '\n', '\r', '\u001b', '\u007f', '\u0085', '\u009f',
  '؜', '‎', '‏', '‪', '‫', '‬', '‭', '‮', '⁦', '⁧', '⁨', '⁩',
  ' ', ' ', '﻿', '\ud800', '\udfff', '😀', 'é',
  '*', ',', '.', '"', "'", '\\', '$', '&', '`', '=', '#', ':', '|', '{', '}', '[', ']', ' ', '-',
]

/** Any text at all: ordinary words, any code point, and the characters above, mixed */
const messy = fc
  .array(fc.oneof(fc.constantFrom(...TROUBLE), fc.string({ maxLength: 6 }), fc.string({ unit: 'binary', maxLength: 3 })), { maxLength: 30 })
  .map((pieces) => pieces.join(''))

/** Text that is valid Unicode: no half of a surrogate pair on its own */
const wellFormed = fc.string({ unit: 'grapheme', maxLength: 60 })
/** A signing secret is never empty (the keys page asks for 16 characters or more), and Web Crypto refuses an empty key */
const secretText = fc.string({ unit: 'grapheme', minLength: 1, maxLength: 60 })

/** What may go in an HTTP header: visible ASCII and spaces */
const headerText = fc.string({ unit: fc.constantFrom(...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i))), maxLength: 80 })

const hexDigits = (length: number) => fc.string({ unit: fc.constantFrom(...'0123456789abcdef'), minLength: length, maxLength: length })

// The marks the Unicode standard lists as Bidi_Control, written out here rather than taken from the
// code under test
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/

// ---------------------------------------------------------------- instance names and patterns

describe('fuzz: instance patterns', () => {
  // few different characters, so that patterns and names often nearly match
  const alphabet = fc.constantFrom('a', 'b', '-', '.', 'é', '😀')
  const name = fc.string({ unit: alphabet, maxLength: 12 })
  const pattern = fc.string({ unit: fc.oneof(alphabet, fc.constant('*')), maxLength: 12 })
  const asRegExp = (text: string) => new RegExp(`^${text.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('[\\s\\S]*')}$`)

  test('a pattern matches exactly what the same pattern does as a regular expression', () => {
    fc.assert(fc.property(pattern, name, (p, n) => matchesInstance(p, n) === asRegExp(p).test(n)))
  })

  test('a name matches itself, and without a star nothing else', () => {
    fc.assert(
      fc.property(messy, messy, (a, b) => {
        expect(matchesInstance(a, a)).toBe(true)
        expect(matchesInstance('*', b)).toBe(true)
        if (!a.includes('*')) expect(matchesInstance(a, b)).toBe(a === b)
      }),
    )
  })

  test('what a person typed becomes a clean list: trimmed, no empties, no repeats', () => {
    fc.assert(
      fc.property(messy, (text) => {
        const list = parsePatterns(text)
        for (const item of list) {
          expect(item).toBe(item.trim())
          expect(item).not.toBe('')
          expect(/[\n,]/.test(item)).toBe(false)
        }
        expect(new Set(list).size).toBe(list.length)
        expect(parsePatterns(list.join('\n'))).toEqual(list)
      }),
    )
  })

  test('an accepted instance name has 1 to 64 characters and no control character', () => {
    fc.assert(
      fc.property(fc.oneof(messy, fc.anything()), (value) => {
        if (!isInstanceName(value)) return
        expect([...value].length).toBeGreaterThanOrEqual(1)
        expect([...value].length).toBeLessThanOrEqual(64)
        expect(/[\u0000-\u001f\u007f-\u009f]/.test(value)).toBe(false)
      }),
    )
  })
})

// ---------------------------------------------------------------- signatures and encryption

describe('fuzz: encodings', () => {
  const bytes = fc.uint8Array({ maxLength: 200 })

  test('hex and base64 give back the bytes they were made from', () => {
    fc.assert(
      fc.property(bytes, (value) => {
        expect(toHex(value)).toMatch(/^[0-9a-f]*$/)
        expect([...fromHex(toHex(value))!]).toEqual([...value])
        expect([...fromBase64(toBase64(value))!]).toEqual([...value])
      }),
    )
  })

  test('text that is not hex or base64 is turned down, never read as something', () => {
    fc.assert(
      fc.property(fc.oneof(messy, hexDigits(7), hexDigits(64)), (text) => {
        const hex = fromHex(text)
        if (hex) expect(toHex(hex)).toBe(text.toLowerCase())
        const base64 = fromBase64(text)
        expect(base64 === null || base64 instanceof Uint8Array).toBe(true)
      }),
    )
  })
})

describe('fuzz: signature', () => {
  const body = fc.uint8Array({ maxLength: 300 })
  const timestamp = fc.nat({ max: 999_999_999_999 }).map(String)

  test('a signature verifies, and stops verifying when anything that was signed changes', async () => {
    await fc.assert(
      fc.asyncProperty(secretText, timestamp, body, fc.nat(), fc.nat(), async (secret, at, bytes, where, bit) => {
        const signature = await signAlert(secret, at, bytes)
        expect(await verifyAlert(secret, at, bytes, signature)).toBe(true)

        expect(await verifyAlert(`${secret}x`, at, bytes, signature)).toBe(false)
        expect(await verifyAlert(secret, `${at}0`, bytes, signature)).toBe(false)
        if (bytes.length) {
          const changed = bytes.slice()
          changed[where % changed.length]! ^= 1 << (bit % 8)
          expect(await verifyAlert(secret, at, changed, signature)).toBe(false)
        }
        const digit = where % 64
        const other = signature[digit] === '0' ? '1' : '0'
        expect(await verifyAlert(secret, at, bytes, signature.slice(0, digit) + other + signature.slice(digit + 1))).toBe(false)
      }),
    )
  })

  test('anything offered as a signature is answered, and only the right one with yes', async () => {
    await fc.assert(
      fc.asyncProperty(secretText, timestamp, body, fc.oneof(messy, hexDigits(64), hexDigits(62)), async (secret, at, bytes, offered) => {
        const right = await signAlert(secret, at, bytes)
        expect(await verifyAlert(secret, at, bytes, offered)).toBe(offered.toLowerCase() === right)
      }),
    )
  })
})

describe('fuzz: stored secrets', () => {
  const KEY = toBase64(randomBytes(32))
  const OTHER = toBase64(randomBytes(32))
  const refusal = /^(not a sealed secret|cannot decrypt: SECRETS_KEY is not the one this secret was stored with)$/

  test('a secret comes back as it went in, not at all with another key, and never as something else', async () => {
    await fc.assert(
      fc.asyncProperty(wellFormed, fc.nat(), async (secret, where) => {
        const sealed = await sealSecret(KEY, secret)
        expect(await openSecret(KEY, sealed)).toBe(secret)
        await expect(openSecret(OTHER, sealed)).rejects.toThrow(refusal)

        // One character of the stored form replaced by another. The last character of base64 can
        // hold bits that are not part of the bytes, so a change there may leave the bytes as they
        // were: then the secret still opens, to what it was. What must never happen is another secret
        const at = 3 + (where % (sealed.length - 3))
        const changed = sealed.slice(0, at) + (sealed[at] === 'A' ? 'B' : 'A') + sealed.slice(at + 1)
        const opened = await openSecret(KEY, changed).catch((error: Error) => error)
        if (opened instanceof Error) expect(opened.message).toMatch(refusal)
        else expect(opened).toBe(secret)
      }),
    )
  })

  test('text that was never a sealed secret is refused in one of the two ways', async () => {
    await fc.assert(
      fc.asyncProperty(fc.oneof(messy, messy.map((text) => `v1.${text}`), fc.tuple(fc.base64String(), fc.base64String()).map(([a, b]) => `v1.${a}.${b}`)), async (text) => {
        await expect(openSecret(KEY, text)).rejects.toThrow(refusal)
      }),
    )
  })
})

// ---------------------------------------------------------------- the receiver

describe('fuzz: receiver', () => {
  const SECRETS_KEY = toBase64(randomBytes(32))
  const SECRET = 'the-secret-of-the-fuzzed-hosts-0123456789'
  const ADDRESS = 'https://hook.example.com'
  let sealed: string
  let fingerprint: string

  beforeAll(async () => {
    sealed = await sealSecret(SECRETS_KEY, SECRET)
    fingerprint = await secretFingerprint(SECRET)
  })

  const now = () => Math.floor(Date.now() / 1000)

  /** A receiver with an empty database and one key, for web-* and db-01 */
  function receiver() {
    const db = createTestDb()
    const env: Env = { DB: db.d1, SECRETS_KEY }
    const pending: Promise<unknown>[] = []
    const ctx = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise), passThroughOnException: () => {} } as unknown as ExecutionContext
    bucket.tokens = BUCKET_SIZE
    bucket.at = 0
    const { id } = db.sqlite
      .query('INSERT INTO signing_keys (name, secret_enc, fingerprint, enabled, created_at) VALUES (?, ?, ?, 1, ?) RETURNING id')
      .get('fuzz', sealed, fingerprint, now()) as { id: number }
    for (const pattern of ['web-*', 'db-01']) db.sqlite.run('INSERT INTO key_instances (key_id, pattern) VALUES (?, ?)', [id, pattern])
    return {
      async send(request: Request): Promise<number> {
        const response = (await handleRequest(request as never, env, ctx)) as unknown as Response
        await Promise.all(pending.splice(0))
        return response.status
      },
      alerts: () => db.sqlite.query('SELECT * FROM alerts').all() as Record<string, unknown>[],
    }
  }

  /** A request signed the way httpdog signs it, for the body as it is given here */
  async function signed(body: string | Uint8Array<ArrayBuffer>, signedBody: string | Uint8Array<ArrayBuffer> = body): Promise<Request> {
    const timestamp = String(now())
    const signature = await signAlert(SECRET, timestamp, typeof signedBody === 'string' ? utf8(signedBody) : signedBody)
    return new Request(`${ADDRESS}/alerts`, {
      method: 'POST',
      headers: { 'x-httpdog-timestamp': timestamp, 'x-httpdog-signature': `sha256=${signature}` },
      body,
    })
  }

  /** An instance the key lists */
  const listed = fc.string({ unit: 'grapheme', maxLength: 20 }).map((rest) => `web-${rest}`).filter(isInstanceName)
  /** A valid instance name that the key does not list */
  const unlisted = fc.string({ unit: 'grapheme', minLength: 1, maxLength: 20 }).filter((name) => isInstanceName(name) && !name.startsWith('web-') && name !== 'db-01')

  /** An alert whose fields hold anything JSON can: what a future, or a broken, httpdog might send */
  const alert = (instance: fc.Arbitrary<string>) =>
    fc
      .record({
        instance,
        extra: fc.dictionary(fc.string({ maxLength: 12 }), fc.jsonValue(), { maxKeys: 6 }),
        known: fc.record(
          Object.fromEntries(
            ['version', 'kind', 'rule', 'timestamp', 'text', 'message', 'group_by', 'group', 'hits', 'window_secs', 'dropped', 'event'].map((field) => [
              field,
              fc.oneof(fc.jsonValue(), messy, fc.double(), fc.maxSafeInteger()),
            ]),
          ),
          { requiredKeys: [] },
        ),
      })
      .map(({ instance, extra, known }) => JSON.stringify({ ...extra, ...known, source: 'httpdog', instance }))

  const STATUSES = [200, 204, 400, 401, 404, 405, 413]

  test('whatever arrives unsigned is answered without an error, and nothing is stored', async () => {
    const request = fc.record({
      method: fc.constantFrom('POST', 'POST', 'POST', 'GET', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH'),
      path: fc.constantFrom('/alerts', '/alerts', '/alerts', '/alerts/', '/health', '/', '/alerts?x=1', '/ALERTS'),
      timestamp: fc.option(fc.oneof(headerText, fc.nat().map(String), fc.constant(String(now())))),
      signature: fc.option(fc.oneof(headerText, hexDigits(64).map((hex) => `sha256=${hex}`))),
      ip: fc.option(headerText),
      body: fc.oneof(fc.uint8Array({ maxLength: 400 }), messy.map(utf8), alert(fc.oneof(listed, unlisted, messy)).map(utf8), fc.jsonValue().map((value) => utf8(JSON.stringify(value)))),
    })
    await fc.assert(
      fc.asyncProperty(request, async ({ method, path, timestamp, signature, ip, body }) => {
        const house = receiver()
        const headers: Record<string, string> = {}
        if (timestamp !== null) headers['x-httpdog-timestamp'] = timestamp
        if (signature !== null) headers['x-httpdog-signature'] = signature
        if (ip !== null) headers['cf-connecting-ip'] = ip
        const status = await house.send(new Request(ADDRESS + path, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : body }))
        expect(STATUSES).toContain(status)
        expect(status).not.toBe(204)
        expect(house.alerts()).toEqual([])
      }),
    )
  })

  test('a signed alert is stored once, whole, whatever its fields hold', async () => {
    await fc.assert(
      fc.asyncProperty(alert(listed), async (body) => {
        const house = receiver()
        expect(await house.send(await signed(body))).toBe(204)
        expect(await house.send(await signed(body))).toBe(204)

        const rows = house.alerts()
        expect(rows.length).toBe(1)
        const row = rows[0]!
        expect(row.body).toBe(body)
        expect(row.deliveries).toBe(2)
        expect(row.instance).toBe(JSON.parse(body).instance)
        // what the lists sort and count by is always a whole number the UI can show
        for (const column of ['received_at', 'fired_at', 'version']) expect(Number.isSafeInteger(row[column])).toBe(true)
        for (const column of ['hits', 'window_secs', 'dropped']) expect(row[column] === null || Number.isSafeInteger(row[column])).toBe(true)
        for (const column of ['kind', 'rule', 'message']) expect(typeof row[column]).toBe('string')
      }),
    )
  })

  test('a body changed after it was signed is refused', async () => {
    await fc.assert(
      fc.asyncProperty(alert(listed), fc.nat(), fc.nat(), async (body, where, bit) => {
        const original = utf8(body)
        const changed = original.slice()
        changed[where % changed.length]! ^= 1 << (bit % 8)
        const house = receiver()
        const status = await house.send(await signed(changed, original))
        expect([400, 401]).toContain(status)
        expect(house.alerts()).toEqual([])
      }),
    )
  })

  test('an instance no key lists is refused, even with a valid signature', async () => {
    await fc.assert(
      fc.asyncProperty(alert(unlisted), async (body) => {
        const house = receiver()
        expect(await house.send(await signed(body))).toBe(401)
        expect(house.alerts()).toEqual([])
      }),
    )
  })
})

// ---------------------------------------------------------------- text from access logs, on a page

describe('fuzz: text shown on a page', () => {
  // What the property below found the first time it ran: U+061C reverses text and was let through
  test('the Arabic letter mark is shown as an escape, like the other marks that reverse text', () => {
    expect(printable('GET /a؜b ‮gnp.exe')).toBe('GET /a\\u061cb \\u202egnp.exe')
  })

  test('nothing invisible is left in text made printable, and plain text is left alone', () => {
    fc.assert(
      fc.property(messy, (text) => {
        const shown = printable(text)
        expect(INVISIBLE.test(shown)).toBe(false)
        if (!INVISIBLE.test(text)) expect(shown).toBe(text)
      }),
    )
  })

  test('highlighting only cuts text into pieces: put together again, it is the same text', () => {
    const lang = fc.constantFrom<Lang>('yaml', 'shell', 'env', 'json', 'log', 'text')
    const code = fc.oneof(messy, fc.jsonValue().map((value) => JSON.stringify(value, null, 2)), fc.array(fc.constantFrom('"', "'", '\\', '#', ':', ' ', '-', '$', '{', 'a', '1', '\n', '|', '='), { maxLength: 80 }).map((chars) => chars.join('')))
    fc.assert(
      fc.property(code, lang, (text, language) => {
        const lines = highlight(text, language)
        expect(lines.map((tokens) => tokens.map((token) => token.s).join('')).join('\n')).toBe(text)
        for (const tokens of lines) {
          if (tokens.length > 1) for (const token of tokens) expect(token.s).not.toBe('')
        }
      }),
    )
  })
})

// ---------------------------------------------------------------- deploy.local.env

describe('fuzz: deploy.local.env', () => {
  const key = fc.constantFrom('DATABASE_ID', 'INGEST_URL', 'UI_DOMAIN', 'NAME_SUFFIX')
  // a value as setup writes one: a single line
  const value = messy.map((text) => text.replace(/\n/g, ''))
  const line = fc.oneof(fc.constant(''), messy.map((text) => `# ${text.replace(/\n/g, ' ')}`), fc.tuple(key, value).map(([k, v]) => `${k}=${v}`))
  const file = fc.tuple(fc.array(line, { maxLength: 8 }), fc.boolean()).map(([lines, newline]) => lines.join('\n') + (newline && lines.length ? '\n' : ''))

  test('a value that is set is the value that is read back, and the other values stay', () => {
    fc.assert(
      fc.property(file, key, value, (text, name, written) => {
        const before = parseEnv(text)
        const after = parseEnv(setEnvValue(text, name, written))
        expect(after[name]).toBe(parseEnv(`${name}=${written}`)[name]!)
        for (const other of Object.keys(before)) if (other !== name) expect(after[other]).toBe(before[other]!)
      }),
    )
  })
})
