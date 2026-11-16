// GET /api/auth/session: who is signed in, or `user: null`. Open to anyone: the pages ask this first.

import type { SessionUser } from '#shared/api'

export default defineEventHandler(async (event): Promise<{ user: SessionUser | null }> => {
  return { user: await readSession(event) }
})
