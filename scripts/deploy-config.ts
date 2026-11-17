// Keeps what is yours out of the repository. The real database id, the receiver's address and your
// hostnames live in deploy.local.env, which is not committed; this script puts them into the
// configs wrangler deploys from. The two wrangler.jsonc files that are committed keep their example
// values, so a clone of the repository never carries anybody's deployment.
//
//   bun scripts/deploy-config.ts check    stop unless deploy.local.env is usable and the committed configs are still examples
//   bun scripts/deploy-config.ts ingest   check, then write ingest/wrangler.deploy.json
//   bun scripts/deploy-config.ts ui       check, then put the values into .output/server/wrangler.json (after `nuxt build`)
//
// The Makefile runs these; nothing here uploads anything.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** The database_id both committed configs ship with */
export const PLACEHOLDER = '00000000-0000-0000-0000-000000000000'

const ROOT = resolve(import.meta.dir, '..')
const LOCAL = 'deploy.local.env'
const UI_TEMPLATE = 'wrangler.jsonc'
const INGEST_TEMPLATE = 'ingest/wrangler.jsonc'
/** Next to its template, so the paths inside (src/index.ts, ../migrations) mean the same */
const INGEST_DEPLOY = 'ingest/wrangler.deploy.json'
/** What `nuxt build` generates from wrangler.jsonc, and what `wrangler deploy` uploads the UI from */
const UI_BUILT = '.output/server/wrangler.json'

export type Worker = 'ui' | 'ingest'

export interface DeployValues {
  databaseId: string
  /** Where httpdog should POST; undefined leaves the example in place */
  ingestUrl?: string
  uiDomain?: string
  ingestDomain?: string
}

export interface WranglerConfig {
  d1_databases?: { database_id?: string }[]
  vars?: Record<string, string>
  routes?: unknown
  workers_dev?: boolean
  preview_urls?: boolean
  [key: string]: unknown
}

/** KEY=value lines; blank lines and lines starting with # are skipped, quotes around a value dropped */
export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const equals = line.indexOf('=')
    if (!line || line.startsWith('#') || equals < 1) continue
    const value = line.slice(equals + 1).trim()
    values[line.slice(0, equals).trim()] = /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value
  }
  return values
}

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i

/** The values of deploy.local.env, checked. Throws with a message meant for the terminal */
export function readValues(env: Record<string, string>): DeployValues {
  const databaseId = env.DATABASE_ID ?? ''
  if (!databaseId || databaseId === PLACEHOLDER) throw new Error(`DATABASE_ID is not set in ${LOCAL}; \`make db-create\` prints it`)
  if (!UUID.test(databaseId)) throw new Error(`DATABASE_ID in ${LOCAL} does not look like a D1 database id`)

  const domain = (name: 'UI_DOMAIN' | 'INGEST_DOMAIN') => {
    const value = env[name]
    if (!value) return undefined
    if (!HOSTNAME.test(value)) throw new Error(`${name} in ${LOCAL} must be a hostname alone, like alerts.example.com`)
    return value
  }
  const uiDomain = domain('UI_DOMAIN')
  const ingestDomain = domain('INGEST_DOMAIN')

  let ingestUrl = env.INGEST_URL || undefined
  if (ingestUrl) {
    if (!URL.canParse(ingestUrl) || !/^https?:$/.test(new URL(ingestUrl).protocol) || !new URL(ingestUrl).pathname.endsWith('/alerts')) {
      throw new Error(`INGEST_URL in ${LOCAL} must be the receiver's address ending in /alerts`)
    }
  } else if (ingestDomain) {
    ingestUrl = `https://${ingestDomain}/alerts`
  }
  return { databaseId, ingestUrl, uiDomain, ingestDomain }
}

/** A copy of a Worker's config with the values in place of the examples */
export function applyValues(config: WranglerConfig, values: DeployValues, worker: Worker): WranglerConfig {
  const result: WranglerConfig = {
    ...config,
    d1_databases: (config.d1_databases ?? []).map((database) => ({ ...database, database_id: values.databaseId })),
  }
  if (worker === 'ui' && values.ingestUrl) result.vars = { ...config.vars, INGEST_URL: values.ingestUrl }
  const hostname = worker === 'ui' ? values.uiDomain : values.ingestDomain
  if (hostname) {
    result.routes = [{ pattern: hostname, custom_domain: true }]
    result.workers_dev = false
    result.preview_urls = false
  }
  return result
}

/** What makes a committed config no longer an example, or null when it still is one */
export function leak(config: WranglerConfig): string | null {
  if ((config.d1_databases ?? []).some((database) => database.database_id !== PLACEHOLDER)) return 'a real database_id'
  if (config.routes !== undefined) return 'routes'
  if (config.vars?.INGEST_URL !== undefined && !config.vars.INGEST_URL.includes('.example.')) return 'a real INGEST_URL'
  return null
}

function readTemplate(path: string): WranglerConfig {
  return Bun.JSONC.parse(readFileSync(resolve(ROOT, path), 'utf8')) as WranglerConfig
}

function check(): DeployValues {
  for (const path of [UI_TEMPLATE, INGEST_TEMPLATE]) {
    const found = leak(readTemplate(path))
    if (found) throw new Error(`${path} has ${found}. That file is committed: move the value to ${LOCAL} and put the example back`)
  }
  if (!existsSync(resolve(ROOT, LOCAL))) throw new Error(`${LOCAL} is missing: copy ${LOCAL}.example to it and fill in DATABASE_ID (\`make db-create\` does both)`)
  return readValues(parseEnv(readFileSync(resolve(ROOT, LOCAL), 'utf8')))
}

function write(path: string, config: WranglerConfig) {
  writeFileSync(resolve(ROOT, path), JSON.stringify(config, null, 2) + '\n')
  console.log(`wrote ${path}`)
}

if (import.meta.main) {
  const command = process.argv[2]
  try {
    if (command === 'check') {
      const values = check()
      if (!values.ingestUrl) console.log(`note: neither INGEST_URL nor INGEST_DOMAIN is set in ${LOCAL}; the keys page will show the example address until one is`)
    } else if (command === 'ingest') {
      write(INGEST_DEPLOY, applyValues(readTemplate(INGEST_TEMPLATE), check(), 'ingest'))
    } else if (command === 'ui') {
      const values = check()
      if (!existsSync(resolve(ROOT, UI_BUILT))) throw new Error(`${UI_BUILT} is missing: build the UI first (make deploy-ui does both)`)
      const built = JSON.parse(readFileSync(resolve(ROOT, UI_BUILT), 'utf8')) as WranglerConfig
      write(UI_BUILT, applyValues(built, values, 'ui'))
    } else {
      throw new Error('usage: bun scripts/deploy-config.ts check | ingest | ui')
    }
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
}
