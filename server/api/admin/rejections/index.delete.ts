// DELETE /api/admin/rejections: clear the list, to see only what happens after a fix.

export default defineEventHandler(async (event): Promise<{ ok: true }> => {
  await useDb(event).prepare('DELETE FROM rejections').run()
  audit(event, 'rejections.clear')
  return { ok: true }
})
