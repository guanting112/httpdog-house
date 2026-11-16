// PATCH /api/admin/keys/:id { name?, enabled?, patterns? }: change a key. Only what is sent changes.
//
// The secret cannot be changed here. To change a secret without losing alerts, add a second key
// for the same instances, move the hosts to it one by one, then delete this one.

import type { KeyRow } from '#shared/api'

export default defineEventHandler(async (event): Promise<{ key: KeyRow }> => {
  const db = useDb(event)
  const id = idParam(event)
  const body = await readJson(event)

  const statements = []
  if (body.name !== undefined) {
    statements.push(db.prepare('UPDATE signing_keys SET name = ?1 WHERE id = ?2').bind(readKeyName(body.name), id))
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') fail(400, 'bad_input', 'enabled must be true or false')
    statements.push(db.prepare('UPDATE signing_keys SET enabled = ?1 WHERE id = ?2').bind(body.enabled ? 1 : 0, id))
  }
  if (body.patterns !== undefined) {
    const patterns = readPatterns(body.patterns)
    statements.push(db.prepare('DELETE FROM key_instances WHERE key_id = ?1').bind(id))
    // through signing_keys, so nothing is inserted for an id that does not exist
    for (const pattern of patterns) {
      statements.push(db.prepare('INSERT INTO key_instances (key_id, pattern) SELECT id, ?2 FROM signing_keys WHERE id = ?1').bind(id, pattern))
    }
  }

  if (statements.length) {
    try {
      await db.batch(statements)
    } catch (error) {
      if (isUniqueViolation(error)) fail(409, 'name_taken', 'a key with this name already exists')
      throw error
    }
  }

  const [key] = await loadKeys(db, id)
  if (!key) fail(404, 'not_found', 'no such key')
  audit(event, 'key.update', { key: key.name, changed: Object.keys(body).filter((field) => ['name', 'enabled', 'patterns'].includes(field)) })
  return { key }
})
