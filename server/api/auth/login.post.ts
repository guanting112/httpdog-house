// POST /api/auth/login { username, password }: starts a session.

import type { SessionUser } from '#shared/api'

interface UserRecord extends SessionUser {
  password_hash: string
  disabled: number
}

export default defineEventHandler(async (event): Promise<{ user: SessionUser }> => {
  const env = useEnv(event)
  const body = await readJson(event)
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  // Counted per address and per Cloudflare location, before the password is looked at
  if (env.LOGIN_LIMITER) {
    const key = getRequestHeader(event, 'cf-connecting-ip') ?? 'unknown'
    const { success } = await env.LOGIN_LIMITER.limit({ key })
    if (!success) fail(429, 'rate_limited', 'too many attempts, wait a minute')
  }

  const user =
    USERNAME.test(username) && password.length <= PASSWORD_MAX
      ? await env.DB.prepare('SELECT id, username, role, password_hash, disabled FROM users WHERE username = ?1').bind(username).first<UserRecord>()
      : null
  // A name that does not exist is checked against a placeholder, so it takes as long as a real one
  const matches = await verifyPassword(password.slice(0, PASSWORD_MAX), user?.password_hash ?? NO_SUCH_USER_HASH)
  if (!user || !matches || user.disabled) fail(401, 'wrong_login', 'wrong username or password')

  await startSession(event, user.id)
  await env.DB.prepare('UPDATE users SET last_login_at = ?1 WHERE id = ?2').bind(unixNow(), user.id).run()
  return { user: { id: user.id, username: user.username, role: user.role } }
})
