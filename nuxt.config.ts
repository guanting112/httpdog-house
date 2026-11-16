// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-11-15',
  devtools: { enabled: true },

  // Every page sits behind the login and shows data that changes by the second, so there is
  // nothing to render on the server. The pages are static files; the Worker only answers /api.
  // It also means times are formatted once, in the reader's own time zone.
  ssr: false,

  // Ubuntu Mono is served from this site (no request to a font CDN). Only the Latin subset is
  // loaded; Chinese text falls through to the system font (see --mono in main.css).
  css: [
    '@fontsource/ubuntu-mono/latin-400.css',
    '@fontsource/ubuntu-mono/latin-400-italic.css',
    '@fontsource/ubuntu-mono/latin-700.css',
    '~/assets/css/main.css',
  ],

  app: {
    head: {
      title: 'httpdog house',
      htmlAttrs: { lang: 'en' },
      meta: [
        // a private tool: nothing here belongs in a search engine
        { name: 'robots', content: 'noindex, nofollow' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
      // Picks dark or light before anything is drawn, so the page never starts in the wrong one:
      // the choice remembered in this browser (app/composables/useTheme.ts), else the system's.
      // It is an inline script; server/plugins/page-headers.ts allows it by its hash.
      script: [
        {
          key: 'theme',
          tagPosition: 'head',
          innerHTML:
            "(function(){var t;try{t=localStorage.getItem('hd_theme')}catch(e){}" +
            "if(t!=='light'&&t!=='dark')t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';" +
            "document.documentElement.setAttribute('data-theme',t)})()",
        },
      ],
    },
  },

  // Runs on Cloudflare Workers: the pages as static assets, server/ as the Worker's code.
  // With deployConfig, the build merges wrangler.jsonc with what Nitro knows (the entry file and
  // the assets directory) into .output/server/wrangler.json, and `wrangler deploy` uses that.
  // In `nuxt dev` the bindings in wrangler.jsonc (D1, the rate limiter) are emulated by wrangler.
  nitro: {
    preset: 'cloudflare_module',
    cloudflare: { deployConfig: true, nodeCompat: true },
  },

  routeRules: {
    // Sent with every answer of the Worker, and written to _headers for the static files
    '/**': {
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'same-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      },
    },
  },
})
