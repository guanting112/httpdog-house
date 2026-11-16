// Signing keys: reading what an admin typed, and reading keys back out of D1.

import type { D1Database } from '@cloudflare/workers-types'
import type { KeyRow } from '#shared/api'
import { isInstancePattern } from '#shared/instances'

const NAME_MAX = 64
const PATTERNS_MAX = 200
// DEL and the C0 / C1 control characters
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
/** A secret someone brings: printable ASCII without spaces, so it survives an environment file as it is */
const SECRET = /^[\x21-\x7e]{16,256}$/

export function readKeyName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name || [...name].length > NAME_MAX || CONTROL.test(name)) fail(400, 'bad_name', `a key name is 1 to ${NAME_MAX} characters`)
  return name
}

/** The list of instance names and patterns for a key. May be empty: such a key accepts nothing yet */
export function readPatterns(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > PATTERNS_MAX) fail(400, 'bad_patterns', `instances must be a list of at most ${PATTERNS_MAX} names`)
  const patterns = new Set<string>()
  for (const item of value) {
    const pattern = typeof item === 'string' ? item.trim() : ''
    if (!isInstancePattern(pattern)) fail(400, 'bad_patterns', 'an instance name is 1 to 64 characters, with * for any run of characters')
    patterns.add(pattern)
  }
  return [...patterns]
}

export function readSecret(value: unknown): string {
  if (typeof value !== 'string' || !SECRET.test(value)) {
    fail(400, 'bad_secret', 'a secret is 16 to 256 printable ASCII characters, without spaces')
  }
  return value
}

interface KeyRecord {
  id: number
  name: string
  fingerprint: string
  enabled: number
  created_at: number
  created_by: string | null
  last_used_at: number | null
}

/** Every key, or only the one with this id. Never the secret */
export async function loadKeys(db: D1Database, id?: number): Promise<KeyRow[]> {
  const only = id === undefined ? '' : 'WHERE k.id = ?1'
  const bind = id === undefined ? [] : [id]
  const [keys, patterns] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT k.id, k.name, k.fingerprint, k.enabled, k.created_at, k.created_by,
                (SELECT max(last_at) FROM alert_sources s WHERE s.key_id = k.id) AS last_used_at
           FROM signing_keys k ${only} ORDER BY k.name COLLATE NOCASE`,
      )
      .bind(...bind),
    db.prepare(`SELECT k.id AS key_id, p.pattern FROM key_instances p JOIN signing_keys k ON k.id = p.key_id ${only} ORDER BY p.pattern`).bind(...bind),
  ])
  const byKey = new Map<number, string[]>()
  for (const row of patterns!.results as unknown as { key_id: number; pattern: string }[]) {
    byKey.set(row.key_id, [...(byKey.get(row.key_id) ?? []), row.pattern])
  }
  return (keys!.results as unknown as KeyRecord[]).map((key) => ({
    id: key.id,
    name: key.name,
    fingerprint: key.fingerprint,
    enabled: key.enabled === 1,
    createdAt: key.created_at,
    createdBy: key.created_by,
    patterns: byKey.get(key.id) ?? [],
    lastUsedAt: key.last_used_at,
  }))
}
