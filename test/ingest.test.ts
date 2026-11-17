// The ingest Worker's fetch handler, run against an in-memory database that has the real schema.
// Requests are signed the way httpdog signs them.

import { beforeEach, describe, expect, test } from 'bun:test'
import { BUCKET_SIZE, bucket, type Env, handleRequest, prune } from '../ingest/src/receiver'
import { randomBytes, sealSecret, secretFingerprint, signAlert, toBase64, utf8 } from '../shared/crypto'
import { createTestDb, type TestDb } from './d1'

const SECRETS_KEY = toBase64(randomBytes(32))
const SECRET = 'a-secret-shared-with-web-01-0123456789'
const URL = 'https://hook.example.com/alerts'

let db: TestDb
let env: Env
let pending: Promise<unknown>[]
const ctx = {
  waitUntil: (promise: Promise<unknown>) => void pending.push(promise),
  passThroughOnException: () => {},
} as unknown as ExecutionContext

const now = () => Math.floor(Date.now() / 1000)

async function addKey(name: string, secret: string, patterns: string[], enabled = true): Promise<number> {
  const sealed = await sealSecret(SECRETS_KEY, secret)
  const { id } = db.sqlite
    .query('INSERT INTO signing_keys (name, secret_enc, fingerprint, enabled, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .get(name, sealed, await secretFingerprint(secret), enabled ? 1 : 0, now()) as { id: number }
  for (const pattern of patterns) db.sqlite.run('INSERT INTO key_instances (key_id, pattern) VALUES (?, ?)', [id, pattern])
  return id
}

function alertBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    source: 'httpdog',
    instance: 'web-01',
    version: 1,
    kind: 'rule',
    rule: 'login-bruteforce',
    timestamp: now(),
    text: '[httpdog] login-bruteforce | 198.51.100.9 repeated login failures | 3x in 60s | remote_addr=198.51.100.9',
    message: '198.51.100.9 repeated login failures',
    group_by: 'remote_addr',
    group: '198.51.100.9',
    hits: 3,
    window_secs: 60,
    dropped: null,
    event: { remote_addr: '198.51.100.9', uri: '/login', status: 401 },
    ...overrides,
  })
}

interface SendOptions {
  secret?: string
  timestamp?: number
  headers?: Record<string, string>
  method?: string
  url?: string
}

async function send(body: string, options: SendOptions = {}): Promise<Response> {
  const timestamp = options.timestamp ?? now()
  const signature = await signAlert(options.secret ?? SECRET, timestamp, utf8(body))
  const response = await handleRequest(
    new Request(options.url ?? URL, {
      method: options.method ?? 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-httpdog-timestamp': String(timestamp),
        'x-httpdog-signature': `sha256=${signature}`,
        'cf-connecting-ip': '203.0.113.50',
        ...options.headers,
      },
      body: options.method === 'GET' ? undefined : body,
    }) as never,
    env,
    ctx,
  )
  await Promise.all(pending)
  pending = []
  return response as unknown as Response
}

const count = (table: string) => (db.sqlite.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
const rejections = () => db.sqlite.query('SELECT reason, instance, ip, detail FROM rejections ORDER BY id').all() as Record<string, string>[]

beforeEach(async () => {
  db = createTestDb()
  env = { DB: db.d1, SECRETS_KEY }
  pending = []
  // each test starts with a full allowance of recorded refusals
  bucket.tokens = BUCKET_SIZE
  bucket.at = 0
  await addKey('prod', SECRET, ['web-01', 'db-*'])
})

describe('a signed alert', () => {
  test('is stored with its fields, the exact body and the key that verified it', async () => {
    const body = alertBody()
    const response = await send(body)
    expect(response.status).toBe(204)

    const row = db.sqlite.query('SELECT * FROM alerts').get() as Record<string, unknown>
    expect(row).toMatchObject({
      instance: 'web-01',
      kind: 'rule',
      rule: 'login-bruteforce',
      message: '198.51.100.9 repeated login failures',
      group_by: 'remote_addr',
      group_value: '198.51.100.9',
      hits: 3,
      window_secs: 60,
      dropped: null,
      version: 1,
      key_id: 1,
      body,
      deliveries: 1,
    })
    expect(row.fired_at).toBe(JSON.parse(body).timestamp)
    expect(count('rejections')).toBe(0)

    expect(db.sqlite.query('SELECT instance, rule, total, key_id FROM alert_sources').all()).toEqual([
      { instance: 'web-01', rule: 'login-bruteforce', total: 1, key_id: 1 },
    ])
    expect(db.sqlite.query('SELECT instance, rule, total FROM alert_hours').all()).toEqual([
      { instance: 'web-01', rule: 'login-bruteforce', total: 1 },
    ])
  })

  test('sent again is still one alert, counted once', async () => {
    const body = alertBody()
    expect((await send(body)).status).toBe(204)
    // httpdog's retry: the same body, a later timestamp and therefore another signature
    expect((await send(body, { timestamp: now() + 2 })).status).toBe(204)

    expect(db.sqlite.query('SELECT deliveries FROM alerts').all()).toEqual([{ deliveries: 2 }])
    expect(db.sqlite.query('SELECT total FROM alert_sources').all()).toEqual([{ total: 1 }])
    expect(db.sqlite.query('SELECT total FROM alert_hours').all()).toEqual([{ total: 1 }])
  })

  test('two different alerts add up in the roll-ups', async () => {
    await send(alertBody({ group: '198.51.100.9' }))
    await send(alertBody({ group: '198.51.100.10' }))
    await send(alertBody({ rule: 'slow-request', group_by: null, group: null, hits: null, window_secs: null }))
    expect(count('alerts')).toBe(3)
    expect(db.sqlite.query('SELECT rule, total FROM alert_sources ORDER BY rule').all()).toEqual([
      { rule: 'login-bruteforce', total: 2 },
      { rule: 'slow-request', total: 1 },
    ])
  })

  test('an overload alert has no event and no group', async () => {
    const body = alertBody({
      kind: 'overload',
      rule: 'overload',
      message: 'falling behind, dropped 7 log lines',
      group_by: null,
      group: null,
      hits: null,
      window_secs: null,
      dropped: 7,
      event: null,
    })
    expect((await send(body)).status).toBe(204)
    expect(db.sqlite.query('SELECT kind, rule, dropped, group_by, hits FROM alerts').get()).toEqual({
      kind: 'overload',
      rule: 'overload',
      dropped: 7,
      group_by: null,
      hits: null,
    })
  })

  test('is accepted for an instance a pattern covers', async () => {
    expect((await send(alertBody({ instance: 'db-primary' }))).status).toBe(204)
    expect((await send(alertBody({ instance: 'web-02' }))).status).toBe(401)
  })

  test('with fields a newer httpdog might send is still stored', async () => {
    const body = alertBody({ version: 2, hits: 'many', kind: 'digest', extra: { anything: true } })
    expect((await send(body)).status).toBe(204)
    expect(db.sqlite.query('SELECT version, hits, kind, body FROM alerts').get()).toEqual({ version: 2, hits: null, kind: 'digest', body })
  })

  // Found by test/fuzz.test.ts: these were stored as they came, as numbers no page can show
  test('with numbers too large to be whole is stored without them', async () => {
    const sentAt = now() - 5
    const body = alertBody({ timestamp: 1e300, hits: 9007199254740993, window_secs: -1e21, dropped: 2.9 })
    expect((await send(body, { timestamp: sentAt })).status).toBe(204)
    // the time falls back to when the request says it was sent
    expect(db.sqlite.query('SELECT fired_at, hits, window_secs, dropped, body FROM alerts').get()).toEqual({ fired_at: sentAt, hits: null, window_secs: null, dropped: 2, body })
  })
})

describe('two keys for one instance', () => {
  test('either secret is accepted, so a secret can be changed host by host', async () => {
    const next = await addKey('prod-next', 'the-next-secret-0123456789abcdef', ['web-01'])
    expect((await send(alertBody({ group: 'a' }))).status).toBe(204)
    expect((await send(alertBody({ group: 'b' }), { secret: 'the-next-secret-0123456789abcdef' })).status).toBe(204)
    expect(db.sqlite.query('SELECT key_id FROM alerts ORDER BY id').all()).toEqual([{ key_id: 1 }, { key_id: next }])
  })

  test('a disabled key is not tried', async () => {
    await addKey('old', 'an-old-secret-0123456789abcdef00', ['web-01'], false)
    expect((await send(alertBody(), { secret: 'an-old-secret-0123456789abcdef00' })).status).toBe(401)
    expect(rejections()[0]).toMatchObject({ reason: 'bad_signature', detail: 'the signature matches none of: prod' })
  })
})

describe('a request that is refused', () => {
  test('wrong secret: 401, nothing stored, the reason recorded', async () => {
    const response = await send(alertBody(), { secret: 'not-the-secret' })
    expect(response.status).toBe(401)
    // the answer does not say which check failed
    expect(await response.text()).toBe('unauthorized\n')
    expect(count('alerts')).toBe(0)
    expect(rejections()).toEqual([
      { reason: 'bad_signature', instance: 'web-01', ip: '203.0.113.50', detail: 'the signature matches none of: prod' },
    ])
  })

  test('a body changed after signing', async () => {
    const body = alertBody()
    const timestamp = now()
    const signature = await signAlert(SECRET, timestamp, utf8(body))
    const response = await send(body.replace('web-01', 'db-01'), {
      timestamp,
      headers: { 'x-httpdog-signature': `sha256=${signature}` },
    })
    expect(response.status).toBe(401)
    expect(rejections()[0]).toMatchObject({ reason: 'bad_signature', instance: 'db-01' })
  })

  test('an old timestamp, even with a valid signature', async () => {
    const response = await send(alertBody(), { timestamp: now() - 301 })
    expect(response.status).toBe(401)
    expect(count('alerts')).toBe(0)
    expect(rejections()[0]).toMatchObject({ reason: 'stale', detail: "the timestamp is 301s behind this receiver's clock" })
    expect((await send(alertBody({ group: 'x' }), { timestamp: now() + 400 })).status).toBe(401)
    expect((await send(alertBody({ group: 'y' }), { timestamp: now() - 200 })).status).toBe(204)
  })

  test('the allowed clock difference can be changed', async () => {
    env.MAX_SKEW_SECS = '30'
    expect((await send(alertBody(), { timestamp: now() - 60 })).status).toBe(401)
  })

  test('an instance no key lists', async () => {
    const response = await send(alertBody({ instance: 'staging-01' }))
    expect(response.status).toBe(401)
    expect(rejections()[0]).toMatchObject({ reason: 'unknown_instance', instance: 'staging-01' })
  })

  test('missing or malformed signature headers', async () => {
    expect((await send(alertBody(), { headers: { 'x-httpdog-signature': '' } })).status).toBe(401)
    expect((await send(alertBody(), { headers: { 'x-httpdog-signature': 'sha256=abc' } })).status).toBe(401)
    expect((await send(alertBody(), { headers: { 'x-httpdog-timestamp': 'yesterday' } })).status).toBe(401)
    expect(rejections().map((row) => row.reason)).toEqual(['no_signature', 'no_signature', 'no_signature'])
    expect(count('alerts')).toBe(0)
  })

  test('a body that is not an alert from httpdog: 400', async () => {
    expect((await send('not json')).status).toBe(400)
    expect((await send('[1,2,3]')).status).toBe(400)
    expect((await send(alertBody({ source: 'someone-else' }))).status).toBe(400)
    expect((await send(alertBody({ instance: '' }))).status).toBe(400)
    expect((await send(alertBody({ instance: 'x'.repeat(65) }))).status).toBe(400)
    expect((await send(alertBody({ instance: 'a\nb' }))).status).toBe(400)
    expect(rejections().every((row) => row.reason === 'bad_body')).toBe(true)
    expect(count('alerts')).toBe(0)
  })

  test('a body over the size limit: 413', async () => {
    const response = await send(alertBody({ message: 'x'.repeat(300_000) }))
    expect(response.status).toBe(413)
    expect(rejections()[0]).toMatchObject({ reason: 'too_large', instance: null })
  })

  test('a key stored with another SECRETS_KEY: 500 and a clear reason', async () => {
    env.SECRETS_KEY = toBase64(randomBytes(32))
    const response = await send(alertBody())
    // a 5xx makes httpdog try again, which is right: nothing is wrong with the request
    expect(response.status).toBe(500)
    expect(rejections()[0]).toMatchObject({ reason: 'key_unreadable', detail: 'signing key "prod" could not be decrypted' })
  })

  test('refusals are written slowly once the burst is used up', async () => {
    for (let i = 0; i < 40; i++) await send(alertBody({ group: String(i) }), { secret: 'not-the-secret' })
    expect(count('rejections')).toBeLessThanOrEqual(13)
    expect(count('rejections')).toBeGreaterThan(0)
  })
})

describe('other requests', () => {
  test('only POST /alerts takes alerts', async () => {
    expect((await send('', { method: 'GET' })).status).toBe(405)
    expect((await send(alertBody(), { url: 'https://hook.example.com/' })).status).toBe(404)
    expect((await send(alertBody(), { url: 'https://hook.example.com/alerts/' })).status).toBe(404)
    expect((await send('', { method: 'GET', url: 'https://hook.example.com/health' })).status).toBe(200)
    expect(count('alerts')).toBe(0)
    expect(count('rejections')).toBe(0)
  })
})

describe('the daily clean-up', () => {
  test('deletes what is past the retention period and keeps the rest', async () => {
    await send(alertBody({ group: 'old' }))
    await send(alertBody({ group: 'new' }))
    await send(alertBody({ rule: 'gone', group: 'old' }))
    await send(alertBody({ group: 'last season' }))
    // the default is 365 days: 500 days ago is past it, 100 days ago is not
    const old = now() - 500 * 86400
    db.sqlite.run(`UPDATE alerts SET received_at = ${old} WHERE group_value = 'old'`)
    db.sqlite.run(`UPDATE alerts SET received_at = ${now() - 100 * 86400} WHERE group_value = 'last season'`)
    db.sqlite.run(`UPDATE alert_sources SET last_at = ${old} WHERE rule = 'gone'`)
    db.sqlite.run(`INSERT INTO alert_hours (hour, instance, rule, total) VALUES (${Math.floor(old / 3600)}, 'web-01', 'gone', 1)`)
    db.sqlite.run(`INSERT INTO users (username, password_hash, role, created_at) VALUES ('a', 'x', 'admin', 0)`)
    db.sqlite.run(`INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ('expired', 1, 0, ${now() - 1}), ('live', 1, 0, ${now() + 60})`)
    db.sqlite.run(`INSERT INTO rejections (at, reason) VALUES (${old}, 'stale'), (${now()}, 'stale')`)

    await prune(env, now())

    expect(db.sqlite.query('SELECT group_value FROM alerts ORDER BY id').all()).toEqual([{ group_value: 'new' }, { group_value: 'last season' }])
    expect(db.sqlite.query('SELECT rule FROM alert_sources').all()).toEqual([{ rule: 'login-bruteforce' }])
    expect(count('alert_hours')).toBe(2)
    expect(db.sqlite.query('SELECT id FROM sessions').all()).toEqual([{ id: 'live' }])
    expect(count('rejections')).toBe(1)
  })

  test('RETENTION_DAYS=0 keeps every alert', async () => {
    env.RETENTION_DAYS = '0'
    await send(alertBody())
    db.sqlite.run('UPDATE alerts SET received_at = 1')
    await prune(env, now())
    expect(count('alerts')).toBe(1)
  })
})
