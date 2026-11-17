// The door (shared/door.ts), as the first thing every request meets. Its name starts with a
// number so that it runs before guard.ts: a request the door turns away never reaches the API.
//
// It sees every request, the files included. wrangler.jsonc arranges that: `run_worker_first`, so
// that Cloudflare does not hand out the files of public/ on its own, and a binding for them that is
// not called ASSETS, so that Nitro's Worker entry does not either. What the door lets through and
// is a file is therefore handed back from here.

import type { H3Event } from 'h3'
import { door, DOOR_COOKIE, DOOR_DAYS, doorToken } from '#shared/door'

interface Bindings {
  ENTRY_PATH?: string
  /** The files of public/. Absent in `nuxt dev`, where Vite serves them */
  FILES?: { fetch(request: Request): Promise<Response> }
}

function cloudflare(event: H3Event): { env?: Bindings; request?: Request } | undefined {
  return (event.context as { cloudflare?: { env?: Bindings; request?: Request } }).cloudflare
}

export default defineEventHandler(async (event) => {
  const { env, request } = cloudflare(event) ?? {}
  const path = event.path.split('?')[0] ?? ''
  const entry = env?.ENTRY_PATH || undefined

  const state = await door(entry, path, getCookie(event, DOOR_COOKIE))

  if (state === 'closed') {
    // The same few bytes for a page, an API call and a file: nothing to tell them apart by
    setResponseStatus(event, 404)
    setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
    setResponseHeader(event, 'cache-control', 'no-store')
    return 'not found\n'
  }

  if (state === 'enter') {
    setCookie(event, DOOR_COOKIE, await doorToken(entry!), {
      httpOnly: true,
      path: '/',
      // Lax, not Strict: the entry address is usually opened from a bookmark, a note or a message,
      // and the page it sends the browser on to must already carry the cookie
      sameSite: 'lax',
      secure: requestOrigin(event).startsWith('https:'),
      maxAge: DOOR_DAYS * 86400,
    })
    setResponseHeader(event, 'cache-control', 'no-store')
    return sendRedirect(event, '/login', 302)
  }

  // Open. A file of public/ is answered here; anything else goes on to the API or the page
  if (env?.FILES && request && (event.method === 'GET' || event.method === 'HEAD') && !path.startsWith('/api/')) {
    const file = await env.FILES.fetch(request)
    if (file.status !== 404) return file
  }
})
