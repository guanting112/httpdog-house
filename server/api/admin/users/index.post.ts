// POST /api/admin/users { username, password, role }: a new account.

import type { UserRow } from '#shared/api'

export default defineEventHandler(async (event): Promise<{ user: UserRow }> => {
  const db = useDb(event)
  const body = await readJson(event)
  const username = readUsername(body.username)
  const password = readPassword(body.password)
  const role = readRole(body.role)

  let id: number | null
  try {
    id = await db
      .prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?1, ?2, ?3, ?4) RETURNING id')
      .bind(username, await hashPassword(password), role, unixNow())
      .first<number>('id')
  } catch (error) {
    if (isUniqueViolation(error)) fail(409, 'name_taken', 'this username is taken')
    throw error
  }

  const user = id === null ? null : await loadUser(db, id)
  if (!user) fail(500, 'internal', 'the account was not stored')
  audit(event, 'user.create', { user: username, role })
  return { user }
})
