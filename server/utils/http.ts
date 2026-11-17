// What every API handler needs: the Worker's bindings, a way to refuse, and a careful reading of input.

import type { D1Database, RateLimit } from '@cloudflare/workers-types'
import type { H3Event } from 'h3'
import type { ApiErrorData, SessionUser } from '#shared/api'

/** The bindings of the UI Worker, declared in wrangler.jsonc */
export interface UiEnv {
  DB: D1Database
  /** 32 random bytes in base64, the same value the ingest Worker has. Encrypts the signing secrets */
  SECRETS_KEY?: string
  /** Where httpdog should POST: the ingest Worker's address. Shown on the keys page */
  INGEST_URL?: string
  /** Slows down password guessing. Absent when the binding is not configured */
  LOGIN_LIMITER?: RateLimit
  /** The one path that lets a browser in (server/middleware/01.door.ts). Absent on a machine, set in every deployment */
  ENTRY_PATH?: string
}

declare module 'h3' {
  interface H3EventContext {
    /** Set by server/middleware/guard.ts for every /api request that needs a signed-in user */
    user?: SessionUser
  }
}

/** What Nitro's Cloudflare preset puts on every request: in production the Worker's own
 *  arguments, in `nuxt dev` the same things emulated by wrangler */
interface CloudflareContext {
  env?: Partial<UiEnv>
  request?: { url: string }
}

function cloudflare(event: H3Event): CloudflareContext | undefined {
  return (event.context as { cloudflare?: CloudflareContext }).cloudflare
}

export function useEnv(event: H3Event): UiEnv {
  const env = cloudflare(event)?.env
  if (!env?.DB) {
    throw createError({ statusCode: 500, statusMessage: 'The D1 binding "DB" is missing: check wrangler.jsonc', data: { code: 'no_database' } })
  }
  return env as UiEnv
}

export function useDb(event: H3Event): D1Database {
  return useEnv(event).DB
}

/**
 * The origin this request was made to, as the browser sees it: "https://alerts.example.com".
 *
 * Taken from the request the Worker was handed, not from h3's getRequestURL(): on Workers h3
 * cannot tell that the connection was HTTPS and answers "http://..." unless a forwarding header
 * happens to say otherwise. Two things depend on getting this right: the check that a request
 * came from this site's own pages, and the Secure flag of the session cookie.
 */
export function requestOrigin(event: H3Event): string {
  return new URL(cloudflare(event)?.request?.url ?? getRequestURL(event)).origin
}

/** Refuse a request. `code` is what the UI translates; `message` is for someone reading the response */
export function fail(statusCode: number, code: string, message: string): never {
  throw createError({ statusCode, statusMessage: message, data: { code } satisfies ApiErrorData })
}

/** The signed-in user. The guard has already refused the request when there is none */
export function currentUser(event: H3Event): SessionUser {
  return event.context.user ?? fail(401, 'unauthorized', 'not signed in')
}

export function unixNow(): number {
  return Math.floor(Date.now() / 1000)
}

/** The JSON object in the request body, or a 400 */
export async function readJson(event: H3Event): Promise<Record<string, unknown>> {
  const body: unknown = await readBody(event).catch(() => null)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) fail(400, 'bad_input', 'the body must be a JSON object')
  return body as Record<string, unknown>
}

/** The numeric id in the path (`[id]`), or a 404: an id that is not a number cannot exist */
export function idParam(event: H3Event): number {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(id) || id < 1) fail(404, 'not_found', 'not found')
  return id
}

/** A query value as one string: `?a=1&a=2` gives the first */
export function queryText(value: unknown, max = 200): string {
  const one = Array.isArray(value) ? value[0] : value
  return typeof one === 'string' ? one.slice(0, max) : ''
}

/** A query value as a whole number of zero or more, or null */
export function queryInt(value: unknown): number | null {
  const text = queryText(value, 20)
  return /^\d{1,15}$/.test(text) ? Number(text) : null
}

/** A line in the Worker's log for the things worth being able to look up later. Never a secret */
export function audit(event: H3Event, action: string, detail: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ audit: action, by: event.context.user?.username ?? null, ...detail }))
}

/** True when the error is SQLite refusing a duplicate of something that must be unique */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
}
