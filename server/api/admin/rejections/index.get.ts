// GET /api/admin/rejections: the latest requests the ingest Worker refused, newest first.
// Nothing in a row was verified: the instance is whatever the body claimed.

import type { RejectionRow } from '#shared/api'

export default defineEventHandler(async (event): Promise<{ items: RejectionRow[] }> => {
  const { results } = await useDb(event)
    .prepare('SELECT id, at, reason, instance, ip, detail FROM rejections ORDER BY id DESC LIMIT 200')
    .all<RejectionRow>()
  return { items: results }
})
