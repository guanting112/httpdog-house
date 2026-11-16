// DELETE /api/admin/users/:id: remove an account and sign it out everywhere.

export default defineEventHandler(async (event): Promise<{ ok: true }> => {
  const db = useDb(event)
  const id = idParam(event)
  const target = await loadUser(db, id)
  if (!target) fail(404, 'not_found', 'no such user')
  if (id === currentUser(event).id) fail(409, 'self', 'you cannot delete your own account')
  if (target.role === 'admin' && !target.disabled && (await otherActiveAdmins(db, id)) === 0) {
    fail(409, 'last_admin', 'this is the last admin')
  }
  // the account's sessions go with it (ON DELETE CASCADE)
  await db.prepare('DELETE FROM users WHERE id = ?1').bind(id).run()
  audit(event, 'user.delete', { user: target.username })
  return { ok: true }
})
