// Decides, before each page, whether the reader may see it. This is for a smooth experience only:
// what actually protects the data is the API (server/middleware/guard.ts), which checks every call.

import { nextPath } from '~/lib/route'

const ADMIN_PAGES = ['/keys', '/rejected', '/users']

export default defineNuxtRouteMiddleware(async (to) => {
  const { user, known, refresh } = useSession()
  if (!known.value) {
    try {
      await refresh()
    } catch {
      // The API did not answer. Treat the reader as signed out; the sign-in page will show why
    }
  }

  if (to.path === '/login') {
    if (user.value) return navigateTo(nextPath(to.query.next))
    return
  }
  if (!user.value) return navigateTo({ path: '/login', query: to.path === '/' ? {} : { next: to.fullPath } })
  if (user.value.role !== 'admin' && ADMIN_PAGES.some((page) => to.path === page || to.path.startsWith(`${page}/`))) return navigateTo('/')
})
