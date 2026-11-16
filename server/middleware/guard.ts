// Runs before every API handler and decides who gets in, so no handler can forget to check.
//
//   /api/auth/login, /api/auth/session   anyone
//   /api/admin/**                        a signed-in admin
//   every other /api/**                  any signed-in user
//
// Requests that are not for the API (the pages and their files) pass through: they hold no data.

import { readSession } from '../utils/session'

const OPEN = new Set(['/api/auth/login', '/api/auth/session'])
const READ_ONLY = new Set(['GET', 'HEAD', 'OPTIONS'])

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0] ?? ''
  if (!path.startsWith('/api/')) return

  // Answers hold alerts and settings: no cache between the Worker and the browser may keep one
  setResponseHeader(event, 'cache-control', 'no-store')

  // A request that changes something must come from this site's own pages. The session cookie is
  // SameSite=Strict already; this is the second lock. Browsers send Origin with every such request
  if (!READ_ONLY.has(event.method)) {
    const origin = getRequestHeader(event, 'origin')
    if (!origin || origin !== requestOrigin(event)) fail(403, 'cross_origin', 'this request did not come from this site')
  }

  if (OPEN.has(path)) return

  const user = await readSession(event)
  if (!user) fail(401, 'unauthorized', 'not signed in')
  if (path.startsWith('/api/admin/') && user.role !== 'admin') fail(403, 'forbidden', 'this needs an admin')
  event.context.user = user
})
