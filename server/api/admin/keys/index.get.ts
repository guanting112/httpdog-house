// GET /api/admin/keys: the signing keys and the instances each accepts. Never a secret.

import type { KeyList } from '#shared/api'

export default defineEventHandler(async (event): Promise<KeyList> => {
  const env = useEnv(event)
  return { ingestUrl: env.INGEST_URL ?? '', keys: await loadKeys(env.DB) }
})
