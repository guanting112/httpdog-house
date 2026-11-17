// Everything the receiving Worker does: check that a request really came from an httpdog it
// knows, then store the alert in D1. index.ts only hands requests and the daily timer to this file.
//
// The contract is httpdog's docs/webhook.md:
//   POST, body = one JSON alert
//   X-Httpdog-Timestamp: <unix seconds>
//   X-Httpdog-Signature: sha256=<hex of HMAC-SHA256(secret, "<timestamp>.<body>")>
//
// Which secret? The body names its instance. The request is checked against every enabled signing
// key that lists that instance (the keys page of the UI). Reading the name before the signature is
// checked gives a forger nothing: the name only picks which secret the signature has to match.

import type { RejectReason } from '../../shared/api'
import { openSecret, sha256Hex, verifyAlert } from '../../shared/crypto'
import { isInstanceName, matchesInstance } from '../../shared/instances'

export interface Env {
  DB: D1Database
  /** 32 random bytes in base64, the same value the UI Worker has. Decrypts the signing secrets */
  SECRETS_KEY: string
  /** How far X-Httpdog-Timestamp may be from this Worker's clock, in seconds. Default 300 */
  MAX_SKEW_SECS?: string
  /** Alerts older than this many days are deleted once a day. 0 keeps them forever. Default 90 */
  RETENTION_DAYS?: string
}

const ALERTS_PATH = '/alerts'

/** An alert is a few KB. httpdog's own input is one syslog datagram, so 256 KiB is far above any real body */
const MAX_BODY_BYTES = 256 * 1024
const DEFAULT_SKEW_SECS = 300
const DEFAULT_RETENTION_DAYS = 90

/** Keys tried for one request. More than two would be unusual: one key, or two while a secret is being changed */
const MAX_KEYS_TRIED = 8

const TIMESTAMP = /^\d{1,12}$/
const SIGNATURE = /^sha256=([0-9a-f]{64})$/

export async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/health') return reply(200, 'ok')
  if (url.pathname !== ALERTS_PATH) return reply(404, 'not found')
  if (request.method !== 'POST') return reply(405, 'method not allowed', { allow: 'POST' })
  try {
    return await receive(request, env, ctx)
  } catch (error) {
    // Only the message: the body, the signature and the secrets must never reach a log
    console.error('ingest failed:', error instanceof Error ? error.message : String(error))
    return reply(500, 'internal error')
  }
}

const STATUS_TEXT: Record<number, string> = {
  200: 'ok',
  400: 'bad request',
  401: 'unauthorized',
  404: 'not found',
  405: 'method not allowed',
  413: 'body too large',
  500: 'internal error',
}

function reply(status: number, text?: string, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : `${text ?? STATUS_TEXT[status] ?? 'error'}\n`, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })
}

export function unixNow(): number {
  return Math.floor(Date.now() / 1000)
}

/** A setting that must be a number of zero or more; anything else falls back */
function setting(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return value !== undefined && value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

// ---------------------------------------------------------------- receiving

async function receive(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const now = unixNow()
  const ip = request.headers.get('cf-connecting-ip')
  let instance: string | null = null

  // The answer never says which check failed; the reason goes to the rejections the UI shows
  const refuse = (status: number, reason: RejectReason, detail: string): Response => {
    ctx.waitUntil(recordRejection(env, { at: now, reason, instance, ip, detail }))
    return reply(status)
  }

  const body = await readBody(request, MAX_BODY_BYTES)
  if (!body) return refuse(413, 'too_large', `the body is larger than ${MAX_BODY_BYTES} bytes`)

  const parsed = parseBody(body)
  if (typeof parsed === 'string') return refuse(400, 'bad_body', parsed)
  instance = parsed.alert.instance as string

  const timestamp = request.headers.get('x-httpdog-timestamp') ?? ''
  const signature = SIGNATURE.exec(request.headers.get('x-httpdog-signature') ?? '')?.[1]
  if (!TIMESTAMP.test(timestamp) || !signature) {
    return refuse(401, 'no_signature', 'X-Httpdog-Timestamp or X-Httpdog-Signature is missing or malformed')
  }

  // A captured request cannot be sent again later: its timestamp is part of what was signed
  const skew = now - Number(timestamp)
  if (Math.abs(skew) > setting(env.MAX_SKEW_SECS, DEFAULT_SKEW_SECS)) {
    return refuse(401, 'stale', `the timestamp is ${Math.abs(skew)}s ${skew > 0 ? 'behind' : 'ahead of'} this receiver's clock`)
  }

  const keys = await keysFor(env, instance)
  if (!keys.length) return refuse(401, 'unknown_instance', 'no enabled signing key lists this instance')

  let verified: SigningKey | undefined
  for (const key of keys) {
    let secret: string
    try {
      secret = await openSecret(env.SECRETS_KEY, key.secret_enc)
    } catch (error) {
      console.error(`cannot read signing key "${key.name}":`, error instanceof Error ? error.message : String(error))
      // 5xx, so httpdog tries again: nothing is wrong with the request
      return refuse(500, 'key_unreadable', `signing key "${key.name}" could not be decrypted`)
    }
    if (await verifyAlert(secret, timestamp, body, signature)) {
      verified = key
      break
    }
  }
  if (!verified) {
    return refuse(401, 'bad_signature', `the signature matches none of: ${keys.map((key) => key.name).join(', ')}`)
  }

  await store(env, parsed, verified.id, now, Number(timestamp), await sha256Hex(body))
  return reply(204)
}

/** The whole body, or null as soon as it turns out to be longer than `limit` */
async function readBody(request: Request, limit: number): Promise<Uint8Array | null> {
  if (Number(request.headers.get('content-length') ?? 0) > limit) return null
  if (!request.body) return new Uint8Array(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

interface Parsed {
  /** The body as text. It parsed as JSON, so it is valid UTF-8 and holds no raw control character */
  text: string
  alert: Record<string, unknown>
}

/** The parsed body, or a sentence saying why it cannot be an alert from httpdog */
function parseBody(body: Uint8Array): Parsed | string {
  let text: string
  let alert: unknown
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body)
    alert = JSON.parse(text)
  } catch {
    return 'the body is not JSON'
  }
  if (typeof alert !== 'object' || alert === null || Array.isArray(alert)) return 'the body is not a JSON object'
  const fields = alert as Record<string, unknown>
  if (fields.source !== 'httpdog') return '"source" is not "httpdog"'
  if (!isInstanceName(fields.instance)) return '"instance" is missing or is not a valid instance name'
  return { text, alert: fields }
}

interface SigningKey {
  id: number
  name: string
  secret_enc: string
}

/** Every enabled key with a pattern that matches this instance */
async function keysFor(env: Env, instance: string): Promise<SigningKey[]> {
  const { results } = await env.DB.prepare(
    `SELECT k.id, k.name, k.secret_enc, p.pattern
       FROM signing_keys k JOIN key_instances p ON p.key_id = k.id
      WHERE k.enabled = 1
      ORDER BY k.id`,
  ).all<SigningKey & { pattern: string }>()
  const keys = new Map<number, SigningKey>()
  for (const row of results) {
    if (!keys.has(row.id) && matchesInstance(row.pattern, instance)) keys.set(row.id, row)
  }
  return [...keys.values()].slice(0, MAX_KEYS_TRIED)
}

// ---------------------------------------------------------------- storing

// The signature is valid at this point, so the body is httpdog's. Fields are still read leniently:
// a future httpdog may change one, and an alert that is stored a little wrong is better than one that
// is refused and lost. The body is kept whole, so nothing is lost either way.

function text(value: unknown, max: number, fallback = ''): string {
  return typeof value === 'string' ? [...value].slice(0, max).join('') : fallback
}

function textOrNull(value: unknown, max: number): string | null {
  return typeof value === 'string' ? text(value, max) : null
}

/** A whole number the database keeps as one and a page can show; 1e300 is a number too, and is neither */
function intOrNull(value: unknown): number | null {
  if (typeof value !== 'number') return null
  const whole = Math.trunc(value)
  return Number.isSafeInteger(whole) ? whole : null
}

async function store(env: Env, parsed: Parsed, keyId: number, now: number, sentAt: number, bodyHash: string): Promise<void> {
  const alert = parsed.alert
  const instance = alert.instance as string
  const rule = text(alert.rule, 200, '(no rule)')
  const kind = text(alert.kind, 32, 'rule')

  const db = env.DB
  await db.batch([
    // httpdog sends again when our answer does not reach it in time, with a new timestamp and
    // signature but the same body. The same body is one alert: a repeat only raises `deliveries`
    db
      .prepare(
        `INSERT INTO alerts (received_at, fired_at, instance, kind, rule, message, group_by, group_value,
                             hits, window_secs, dropped, version, key_id, body, body_sha256)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
         ON CONFLICT (body_sha256) DO UPDATE SET deliveries = deliveries + 1`,
      )
      .bind(
        now,
        intOrNull(alert.timestamp) ?? sentAt,
        instance,
        kind,
        rule,
        text(alert.message, 1000),
        textOrNull(alert.group_by, 200),
        textOrNull(alert.group, 1000),
        intOrNull(alert.hits),
        intOrNull(alert.window_secs),
        intOrNull(alert.dropped),
        intOrNull(alert.version) ?? 0,
        keyId,
        parsed.text,
        bodyHash,
      ),
    // The roll-ups count an alert once: these two do nothing when the statement above found the
    // body already stored (its `deliveries` is then above 1)
    db
      .prepare(
        `INSERT INTO alert_sources (instance, rule, first_at, last_at, total, key_id)
         SELECT ?1, ?2, ?3, ?3, 1, ?4 WHERE (SELECT deliveries FROM alerts WHERE body_sha256 = ?5) = 1
         ON CONFLICT (instance, rule) DO UPDATE
           SET last_at = max(last_at, excluded.last_at), total = total + 1, key_id = excluded.key_id`,
      )
      .bind(instance, rule, now, keyId, bodyHash),
    db
      .prepare(
        `INSERT INTO alert_hours (hour, instance, rule, total)
         SELECT ?1, ?2, ?3, 1 WHERE (SELECT deliveries FROM alerts WHERE body_sha256 = ?4) = 1
         ON CONFLICT (hour, instance, rule) DO UPDATE SET total = total + 1`,
      )
      .bind(Math.floor(now / 3600), instance, rule, bodyHash),
  ])
}

// ---------------------------------------------------------------- refusals

// Anyone can reach this address, so a refusal must cost next to nothing. Writing each one to D1
// would let a stranger fill the database and use up its daily write allowance, which would then
// stop real alerts too. So refusals are written through a small token bucket: a burst (a
// misconfigured httpdog makes 3 attempts per alert) and then a slow trickle. The bucket lives in
// this isolate's memory; it is a limit on cost, not an exact count.
export const BUCKET_SIZE = 12
const REFILL_SECS = 10
/** Rows the table keeps. Older ones are deleted as new ones arrive */
const REJECTIONS_KEPT = 500

/** Exported so a test can refill it */
export const bucket = { tokens: BUCKET_SIZE, at: 0 }

function takeToken(now: number): boolean {
  if (bucket.at === 0) bucket.at = now
  const refill = Math.floor((now - bucket.at) / REFILL_SECS)
  if (refill > 0) {
    bucket.tokens = Math.min(BUCKET_SIZE, bucket.tokens + refill)
    bucket.at += refill * REFILL_SECS
  }
  if (bucket.tokens <= 0) return false
  bucket.tokens--
  return true
}

interface Rejection {
  at: number
  reason: RejectReason
  instance: string | null
  ip: string | null
  detail: string
}

async function recordRejection(env: Env, rejection: Rejection): Promise<void> {
  if (!takeToken(rejection.at)) return
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO rejections (at, reason, instance, ip, detail) VALUES (?1, ?2, ?3, ?4, ?5)').bind(
        rejection.at,
        rejection.reason,
        rejection.instance,
        rejection.ip ? rejection.ip.slice(0, 64) : null,
        rejection.detail.slice(0, 300),
      ),
      env.DB.prepare('DELETE FROM rejections WHERE id <= (SELECT max(id) FROM rejections) - ?1').bind(REJECTIONS_KEPT),
    ])
  } catch (error) {
    // The refusal itself has been answered; failing to note it must not turn into an error
    console.error('cannot record a rejection:', error instanceof Error ? error.message : String(error))
  }
}

// ---------------------------------------------------------------- daily clean-up (cron trigger)

const PRUNE_CHUNK = 2000
/** Statements one run may spend on old alerts. The free plan allows 50 queries per invocation */
const PRUNE_ROUNDS = 20
const REJECTIONS_MAX_AGE_DAYS = 30

export async function prune(env: Env, now: number): Promise<void> {
  const db = env.DB
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at < ?1').bind(now),
    db.prepare('DELETE FROM rejections WHERE at < ?1').bind(now - REJECTIONS_MAX_AGE_DAYS * 86400),
  ])

  const days = setting(env.RETENTION_DAYS, DEFAULT_RETENTION_DAYS)
  if (days === 0) return
  const cutoff = now - days * 86400

  // In pieces: one statement that deletes a very large number of rows can run into D1's time limit.
  // What does not fit in today's run is deleted tomorrow
  for (let round = 0; round < PRUNE_ROUNDS; round++) {
    const result = await db
      .prepare('DELETE FROM alerts WHERE id IN (SELECT id FROM alerts WHERE received_at < ?1 ORDER BY received_at LIMIT ?2)')
      .bind(cutoff, PRUNE_CHUNK)
      .run()
    if (!result.meta.changes) break
  }
  await db.batch([
    db.prepare('DELETE FROM alert_hours WHERE hour < ?1').bind(Math.floor(cutoff / 3600)),
    // an instance and rule that sent nothing within the retention period has no alerts left
    db.prepare('DELETE FROM alert_sources WHERE last_at < ?1').bind(cutoff),
  ])
}
