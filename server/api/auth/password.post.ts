// POST /api/auth/password { current, next }: change your own password.

export default defineEventHandler(async (event): Promise<{ ok: true }> => {
  const db = useDb(event)
  const user = currentUser(event)
  const body = await readJson(event)
  const current = typeof body.current === 'string' ? body.current : ''
  const next = typeof body.next === 'string' ? body.next : ''
  if (next.length < PASSWORD_MIN || next.length > PASSWORD_MAX) {
    fail(400, 'weak_password', `a password is ${PASSWORD_MIN} to ${PASSWORD_MAX} characters`)
  }

  const stored = await db.prepare('SELECT password_hash FROM users WHERE id = ?1').bind(user.id).first<string>('password_hash')
  if (!stored || !(await verifyPassword(current.slice(0, PASSWORD_MAX), stored))) {
    fail(403, 'wrong_password', 'the current password is wrong')
  }

  await db.prepare('UPDATE users SET password_hash = ?1 WHERE id = ?2').bind(await hashPassword(next), user.id).run()
  // Whoever else was signed in with the old password is signed out; this browser stays
  await endSessionsOf(db, user.id, event)
  audit(event, 'password.change')
  return { ok: true }
})
