// Sessions: a random token in a cookie, and its SHA-256 in D1. The database never holds a value
// that could be used as a cookie, and a session ends the moment its row is deleted.

import type { D1Database } from '@cloudflare/workers-types'
import type { H3Event } from 'h3'
import type { SessionUser } from '#shared/api'
import { randomBytes, sha256Hex, toBase64Url } from '#shared/crypto'

const COOKIE = 'hd_session'
const SESSION_DAYS = 30

function sessionId(token: string): Promise<string> {
  return sha256Hex(token)
}

export async function startSession(event: H3Event, userId: number): Promise<void> {
  const token = toBase64Url(randomBytes(32))
  const now = unixNow()
  await useDb(event)
    .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(await sessionId(token), userId, now, now + SESSION_DAYS * 86400)
    .run()
  setCookie(event, COOKIE, token, {
    httpOnly: true,
    // Strict: the cookie is never sent with a request another site started. The pages are static
    // files, so following a link here still works; only the API calls the page makes carry it
    sameSite: 'strict',
    secure: requestOrigin(event).startsWith('https:'),
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  })
}

/** The user this request's cookie belongs to, or null: no cookie, expired, or the account is disabled */
export async function readSession(event: H3Event): Promise<SessionUser | null> {
  const token = getCookie(event, COOKIE)
  if (!token || token.length > 128) return null
  const row = await useDb(event)
    .prepare(
      `SELECT u.id, u.username, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ?1 AND s.expires_at > ?2 AND u.disabled = 0`,
    )
    .bind(await sessionId(token), unixNow())
    .first<SessionUser>()
  return row ?? null
}

export async function endSession(event: H3Event): Promise<void> {
  const token = getCookie(event, COOKIE)
  if (token && token.length <= 128) {
    await useDb(event).prepare('DELETE FROM sessions WHERE id = ?1').bind(await sessionId(token)).run()
  }
  deleteCookie(event, COOKIE, { path: '/' })
}

/** Signs a user out everywhere. With `keep`, everywhere except the browser making this request */
export async function endSessionsOf(db: D1Database, userId: number, keep?: H3Event): Promise<void> {
  const token = keep ? getCookie(keep, COOKIE) : undefined
  if (token) {
    await db.prepare('DELETE FROM sessions WHERE user_id = ?1 AND id <> ?2').bind(userId, await sessionId(token)).run()
  } else {
    await db.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(userId).run()
  }
}
