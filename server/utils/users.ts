// Accounts: reading what an admin typed, and the one rule that must always hold.

import type { D1Database } from '@cloudflare/workers-types'
import type { Role, UserRow } from '#shared/api'

export function readUsername(value: unknown): string {
  const username = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!USERNAME.test(username)) fail(400, 'bad_username', 'a username is 1 to 32 of a-z, 0-9, dot, dash and underscore, starting with a letter or digit')
  return username
}

export function readPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < PASSWORD_MIN || value.length > PASSWORD_MAX) {
    fail(400, 'weak_password', `a password is ${PASSWORD_MIN} to ${PASSWORD_MAX} characters`)
  }
  return value
}

export function readRole(value: unknown): Role {
  if (value !== 'admin' && value !== 'viewer') fail(400, 'bad_input', 'role must be admin or viewer')
  return value
}

interface UserRecord {
  id: number
  username: string
  role: Role
  disabled: number
  created_at: number
  last_login_at: number | null
}

export function toUserRow(record: UserRecord): UserRow {
  return {
    id: record.id,
    username: record.username,
    role: record.role,
    disabled: record.disabled === 1,
    createdAt: record.created_at,
    lastLoginAt: record.last_login_at,
  }
}

export const USER_COLUMNS = 'id, username, role, disabled, created_at, last_login_at'

export async function loadUser(db: D1Database, id: number): Promise<UserRow | null> {
  const record = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?1`).bind(id).first<UserRecord>()
  return record ? toUserRow(record) : null
}

/** How many admins could still sign in if this account stopped being one */
export async function otherActiveAdmins(db: D1Database, exceptId: number): Promise<number> {
  const count = await db
    .prepare("SELECT count(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id <> ?1")
    .bind(exceptId)
    .first<number>('n')
  return count ?? 0
}
