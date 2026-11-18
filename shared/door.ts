// The door of the UI. A deployment's hostname is not a secret (certificates are logged in public,
// and scanners visit every hostname they learn of), so what answers at the bare hostname should
// say nothing: not a sign-in page, not a title, not a file.
//
// The UI therefore answers "not found" to everything, its pages, its API and its files alike,
// until a browser has been to one address: https://<UI_DOMAIN>/<ENTRY_PATH>. That visit leaves a
// cookie, and from then on the browser is let through to the sign-in page and the rest.
//
// The door keeps strangers and scanners from seeing what is here. It is not what protects the
// data: that is still the login behind it. Nothing here depends on Nuxt or Nitro; the Worker's
// part is server/middleware/01.door.ts.

import { sameBytes, sha256Hex, toHex, utf8 } from './crypto'

export const DOOR_COOKIE = 'hd_door'
/** How long a browser is remembered: the longest a browser keeps a cookie */
export const DOOR_DAYS = 400

const ENTRY = /^[A-Za-z0-9_-]{8,64}$/

/** What ENTRY_PATH may be: 8 to 64 letters, digits, dashes and underscores, so it is one piece of a path as it is */
export function isEntryPath(value: unknown): value is string {
  return typeof value === 'string' && ENTRY.test(value)
}

/**
 * A new entry path nobody could guess: 64 random bits as 16 hex digits. Short enough to read out or
 * type, and far more than can be tried over the network: each guess is a request to Cloudflare
 */
export function newEntryPath(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(8)))
}

/**
 * What the cookie holds for this entry path. It follows from the path, so changing ENTRY_PATH
 * turns every browser away until it has been to the new address, and nothing has to be stored.
 * It is a hash, so a cookie that leaks does not give the path away.
 */
export function doorToken(entry: string): Promise<string> {
  return sha256Hex(`httpdog-house door\n${entry}`)
}

export type Door = 'open' | 'enter' | 'closed'

/**
 * What the door does with a request:
 *   open     let it through (it carries the cookie, or this deployment has no door)
 *   enter    this is the entry address: hand out the cookie and send the browser on
 *   closed   answer "not found"
 */
export async function door(entry: string | undefined, path: string, cookie: string | undefined): Promise<Door> {
  // No entry path is set where the UI runs on a machine (make dev, make preview). A deployment always has one
  if (!entry) return 'open'
  if (path === `/${entry}` || path === `/${entry}/`) return 'enter'
  if (!cookie) return 'closed'
  // compared in full whatever the result, so the time taken does not say how close a guess was
  return sameBytes(utf8(cookie), utf8(await doorToken(entry))) ? 'open' : 'closed'
}
