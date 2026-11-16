// POST /api/admin/keys/:id/secret: show a key's secret again, for setting up another host.
// POST, not GET: the answer must never be cached, prefetched or left in a history of addresses.

import { openSecret } from '#shared/crypto'

export default defineEventHandler(async (event): Promise<{ secret: string }> => {
  const env = useEnv(event)
  const key = await env.DB.prepare('SELECT name, secret_enc FROM signing_keys WHERE id = ?1')
    .bind(idParam(event))
    .first<{ name: string; secret_enc: string }>()
  if (!key) fail(404, 'not_found', 'no such key')
  const secret = await openSecret(env.SECRETS_KEY, key.secret_enc).catch((error: Error) => fail(500, 'secrets_key', error.message))
  audit(event, 'key.reveal', { key: key.name })
  return { secret }
})
