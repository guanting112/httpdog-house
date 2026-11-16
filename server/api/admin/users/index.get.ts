// GET /api/admin/users: every account. Never a password hash.

import type { UserRow } from '#shared/api'

export default defineEventHandler(async (event): Promise<{ items: UserRow[] }> => {
  const { results } = await useDb(event).prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY username`).all<Parameters<typeof toUserRow>[0]>()
  return { items: results.map(toUserRow) }
})
