// DELETE /api/admin/keys/:id: remove a key. Its instances are refused from the next request on,
// unless another key lists them. Alerts it already verified stay.

export default defineEventHandler(async (event): Promise<{ ok: true }> => {
  const db = useDb(event)
  const id = idParam(event)
  const name = await db.prepare('SELECT name FROM signing_keys WHERE id = ?1').bind(id).first<string>('name')
  if (name === null) fail(404, 'not_found', 'no such key')
  // key_instances rows go with it (ON DELETE CASCADE)
  await db.prepare('DELETE FROM signing_keys WHERE id = ?1').bind(id).run()
  audit(event, 'key.delete', { key: name })
  return { ok: true }
})
