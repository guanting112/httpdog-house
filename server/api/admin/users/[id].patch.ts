// PATCH /api/admin/users/:id { role?, disabled?, password? }: change an account. Only what is sent changes.
//
// An admin cannot take away their own access here (use another admin for that), and the last
// admin who can sign in cannot be demoted or disabled: there would be nobody left to undo it.

import type { UserRow } from '#shared/api'

export default defineEventHandler(async (event): Promise<{ user: UserRow }> => {
  const db = useDb(event)
  const id = idParam(event)
  const me = currentUser(event)
  const body = await readJson(event)
  const target = await loadUser(db, id)
  if (!target) fail(404, 'not_found', 'no such user')

  const role = body.role === undefined ? target.role : readRole(body.role)
  if (body.disabled !== undefined && typeof body.disabled !== 'boolean') fail(400, 'bad_input', 'disabled must be true or false')
  const disabled = body.disabled === undefined ? target.disabled : body.disabled
  const password = body.password === undefined ? null : readPassword(body.password)

  const losesAdmin = target.role === 'admin' && !target.disabled && (role !== 'admin' || disabled)
  if (losesAdmin && id === me.id) fail(409, 'self', 'you cannot remove your own access')
  if (losesAdmin && (await otherActiveAdmins(db, id)) === 0) fail(409, 'last_admin', 'this is the last admin')

  await db.prepare('UPDATE users SET role = ?1, disabled = ?2 WHERE id = ?3').bind(role, disabled ? 1 : 0, id).run()
  if (password !== null) {
    await db.prepare('UPDATE users SET password_hash = ?1 WHERE id = ?2').bind(await hashPassword(password), id).run()
  }
  // A new password or a disabled account signs that user out everywhere; an admin changing their
  // own password stays signed in on this browser
  if (password !== null || disabled) await endSessionsOf(db, id, id === me.id ? event : undefined)

  audit(event, 'user.update', {
    user: target.username,
    role: role === target.role ? undefined : role,
    disabled: disabled === target.disabled ? undefined : disabled,
    password: password === null ? undefined : 'changed',
  })
  return { user: { ...target, role, disabled } }
})
