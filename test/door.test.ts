// The door of the UI (shared/door.ts): what it does with a request, given the entry path of the
// deployment, the path asked for and the cookie the browser sent.

import { describe, expect, test } from 'bun:test'
import { door, doorToken, isEntryPath, newEntryPath } from '../shared/door'

const ENTRY = 'a-name-nobody-would-guess'

describe('the door', () => {
  test('a browser it has not seen is turned away everywhere but at the entry address', async () => {
    for (const path of ['/', '/login', '/keys', '/api/auth/session', '/favicon.svg', '/robots.txt', '/_nuxt/builds/latest.json', '/alerts/12']) {
      expect(await door(ENTRY, path, undefined)).toBe('closed')
    }
  })

  test('the entry address lets a browser in, with or without a slash after it', async () => {
    expect(await door(ENTRY, `/${ENTRY}`, undefined)).toBe('enter')
    expect(await door(ENTRY, `/${ENTRY}/`, undefined)).toBe('enter')
    // and hands out the cookie again to one that has it, which renews it
    expect(await door(ENTRY, `/${ENTRY}`, await doorToken(ENTRY))).toBe('enter')
  })

  test('nothing near the entry address is the entry address', async () => {
    for (const path of [`/${ENTRY.toUpperCase()}`, `/${ENTRY}x`, `/${ENTRY.slice(0, -1)}`, `/x/${ENTRY}`, `/${ENTRY}/login`, `//${ENTRY}`, `/${ENTRY}//`, ENTRY, `/ ${ENTRY}`]) {
      expect(await door(ENTRY, path, undefined)).toBe('closed')
    }
  })

  test('a browser that has been there is let through everywhere', async () => {
    const cookie = await doorToken(ENTRY)
    for (const path of ['/', '/login', '/api/alerts', '/favicon.svg']) expect(await door(ENTRY, path, cookie)).toBe('open')
  })

  test('only the cookie of this entry path opens it', async () => {
    const cookie = await doorToken(ENTRY)
    expect(await door(ENTRY, '/', '')).toBe('closed')
    expect(await door(ENTRY, '/', ENTRY)).toBe('closed')
    expect(await door(ENTRY, '/', cookie.toUpperCase())).toBe('closed')
    expect(await door(ENTRY, '/', cookie.slice(0, -1))).toBe('closed')
    expect(await door(ENTRY, '/', `${cookie}0`)).toBe('closed')
    // after ENTRY_PATH is changed, the cookie of the old one is worth nothing
    expect(await door('another-name-altogether', '/', cookie)).toBe('closed')
  })

  test('the cookie does not give the entry path away', async () => {
    const cookie = await doorToken(ENTRY)
    expect(cookie).toMatch(/^[0-9a-f]{64}$/)
    expect(cookie).not.toContain(ENTRY)
    expect(await doorToken(ENTRY)).toBe(cookie)
    expect(await doorToken(`${ENTRY}x`)).not.toBe(cookie)
  })

  test('with no entry path there is no door: that is how it runs on a machine', async () => {
    expect(await door(undefined, '/', undefined)).toBe('open')
    expect(await door('', '/login', undefined)).toBe('open')
  })
})

describe('an entry path', () => {
  test('is 8 to 64 letters, digits, dashes and underscores: one piece of an address', () => {
    for (const good of ['abcdefgh', 'A_b-9xyz', 'x'.repeat(64), newEntryPath()]) expect(isEntryPath(good)).toBe(true)
    for (const bad of ['', 'short', 'x'.repeat(65), 'two/parts-here', 'with space1', 'dot.dot.dot', 'query?x=1yy', '%2e%2e%2f%2e', undefined, 12345678]) expect(isEntryPath(bad)).toBe(false)
  })

  test('a new one is long, and never the same twice', () => {
    const made = new Set(Array.from({ length: 200 }, newEntryPath))
    expect(made.size).toBe(200)
    for (const entry of made) expect(entry).toMatch(/^[0-9a-f]{30}$/)
  })
})
