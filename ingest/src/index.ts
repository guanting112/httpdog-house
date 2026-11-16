// The receiving Worker: httpdog POSTs its alerts here.
//
// It has no pages, no sessions and no dependencies, and it is deployed on its own, so a change to
// the UI cannot stop alerts from arriving. That matters because httpdog tries an alert 3 times
// within a few seconds and then gives up.
//
// This file is only the entry point. A Worker's named exports mean something to the runtime, so
// everything else lives in receiver.ts.

import { type Env, handleRequest, prune, unixNow } from './receiver'

export default {
  fetch: handleRequest,

  // The cron trigger in wrangler.jsonc: once a day
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(prune(env, unixNow()))
  },
} satisfies ExportedHandler<Env>
