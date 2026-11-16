// Headers for the page itself (the HTML the Worker answers a navigation with).
//
// The UI shows text that came out of access logs, which is to say text a stranger can choose. Vue
// puts it on the page as text, never as markup, and the Content-Security-Policy below is the
// second lock: even if markup did get through, the browser would run no script that is not one of
// this site's own files, and would send data nowhere but this site.

import { toBase64, utf8 } from '#shared/crypto'

const INLINE_SCRIPT = /<script(?![^>]*\ssrc=)([^>]*)>([\s\S]*?)<\/script>/g

function policy(scriptHashes: string[]): string {
  return [
    "default-src 'none'",
    // this site's own files, and the few small scripts Nuxt writes into the page, by their hash
    `script-src 'self' ${scriptHashes.join(' ')}`.trim(),
    // styles cannot run code; the loading screen is an inline <style>
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

export default defineNitroPlugin((nitroApp) => {
  // `nuxt dev` loads the app through Vite, which needs inline scripts and a websocket of its own
  if (import.meta.dev) return

  nitroApp.hooks.hook('render:html', async (html, { event }) => {
    const page = [...html.head, ...html.bodyPrepend, ...html.body, ...html.bodyAppend].join('')
    const hashes: string[] = []
    for (const [, attributes = '', code = ''] of page.matchAll(INLINE_SCRIPT)) {
      // a JSON block is data for the app to read, not a script the browser runs
      if (attributes.includes('application/json')) continue
      hashes.push(`'sha256-${toBase64(await crypto.subtle.digest('SHA-256', utf8(code)))}'`)
    }
    setResponseHeader(event, 'content-security-policy', policy(hashes))
    // The page names its script files by their hash. After a deploy an old copy of the page would
    // ask for files that are gone, so the browser must always ask for the page again
    setResponseHeader(event, 'cache-control', 'no-cache')
  })

  nitroApp.hooks.hook('render:response', (response) => {
    delete response.headers?.['x-powered-by']
  })
})
