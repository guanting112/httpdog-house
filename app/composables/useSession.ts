// Who is signed in. The answer comes from the API (the session cookie cannot be read by the page),
// is asked once when the app starts, and is kept for every page to read.

import type { SessionUser } from '#shared/api'

export function useSession() {
  const user = useState<SessionUser | null>('session-user', () => null)
  /** false until the API has been asked once */
  const known = useState('session-known', () => false)

  async function refresh(): Promise<void> {
    const answer = await $fetch<{ user: SessionUser | null }>('/api/auth/session')
    user.value = answer.user
    known.value = true
  }

  async function signIn(username: string, password: string): Promise<void> {
    const answer = await $fetch<{ user: SessionUser }>('/api/auth/login', { method: 'POST', body: { username, password } })
    user.value = answer.user
    known.value = true
  }

  async function signOut(): Promise<void> {
    await $fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    user.value = null
    await navigateTo('/login')
  }

  return { user, known, isAdmin: computed(() => user.value?.role === 'admin'), refresh, signIn, signOut }
}
