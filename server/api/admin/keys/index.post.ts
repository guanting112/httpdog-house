// POST /api/admin/keys { name, patterns, secret? }: a new signing key.
//
// Without `secret` one is generated, the same shape as `openssl rand -hex 32`. Either way the
// answer carries the secret once, for the admin to put on the hosts.

import type { KeyRow } from '#shared/api'
import { generateSecret, sealSecret, secretFingerprint } from '#shared/crypto'

export default defineEventHandler(async (event): Promise<{ key: KeyRow; secret: string }> => {
  const env = useEnv(event)
  const body = await readJson(event)
  const name = readKeyName(body.name)
  const patterns = readPatterns(body.patterns ?? [])
  const secret = body.secret === undefined || body.secret === '' ? generateSecret() : readSecret(body.secret)

  const sealed = await sealSecret(env.SECRETS_KEY, secret).catch((error: Error) => fail(500, 'secrets_key', error.message))
  const db = env.DB
  try {
    // One transaction: the key and its instances appear together or not at all
    await db.batch([
      db
        .prepare('INSERT INTO signing_keys (name, secret_enc, fingerprint, enabled, created_at, created_by) VALUES (?1, ?2, ?3, 1, ?4, ?5)')
        .bind(name, sealed, await secretFingerprint(secret), unixNow(), currentUser(event).username),
      ...patterns.map((pattern) =>
        db.prepare('INSERT INTO key_instances (key_id, pattern) SELECT id, ?2 FROM signing_keys WHERE name = ?1').bind(name, pattern),
      ),
    ])
  } catch (error) {
    if (isUniqueViolation(error)) fail(409, 'name_taken', 'a key with this name already exists')
    throw error
  }

  const id = await db.prepare('SELECT id FROM signing_keys WHERE name = ?1').bind(name).first<number>('id')
  const [key] = await loadKeys(db, id ?? 0)
  if (!key) fail(500, 'internal', 'the key was not stored')
  audit(event, 'key.create', { key: name, patterns })
  return { key, secret }
})
