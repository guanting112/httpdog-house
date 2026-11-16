// POST /api/auth/logout: ends this browser's session.

export default defineEventHandler(async (event): Promise<{ ok: true }> => {
  await endSession(event)
  return { ok: true }
})
