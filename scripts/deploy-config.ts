// Keeps what is yours out of the repository. The real database id and your two hostnames live in
// deploy.local.env, which is not committed; this script puts them into the configs wrangler deploys
// from. The two wrangler.jsonc files that are committed keep their example values, so a clone of
// the repository never carries anybody's deployment.
//
// A deployment is always at two hostnames of your own, never on workers.dev: without UI_DOMAIN and
// INGEST_DOMAIN in the file, nothing here goes on.
//
//   bun scripts/deploy-config.ts check           stop unless the file is usable and the committed configs are still examples
//   bun scripts/deploy-config.ts configs         check, then write wrangler.deploy.json and ingest/wrangler.deploy.json
//   bun scripts/deploy-config.ts built           after `nuxt build`: name the files binding in .output/server/wrangler.json
//   bun scripts/deploy-config.ts ui              check, then put the values into .output/server/wrangler.json
//   bun scripts/deploy-config.ts database-name   print the name to create the database with
//   bun scripts/deploy-config.ts entry           print the two addresses: to sign in at, and for httpdog to send to
//
// One file is one deployment. A second deployment in the same Cloudflare account has a file of its
// own with a NAME_SUFFIX, which names its two Workers and its database apart from the first's;
// DEPLOY_ENV in the environment says which file to read (the Makefile passes it on).
//
// The Makefile runs these; nothing here uploads anything. On a first deployment scripts/setup.ts
// fills in the rest of the file, once the two hostnames are in it.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isEntryPath } from '../shared/door'

/** The database_id both committed configs ship with */
export const PLACEHOLDER = '00000000-0000-0000-0000-000000000000'

export const ROOT = resolve(import.meta.dir, '..')
/** The file of the deployment in hand */
export const LOCAL = process.env.DEPLOY_ENV || 'deploy.local.env'
export const LOCAL_EXAMPLE = 'deploy.local.env.example'
const UI_TEMPLATE = 'wrangler.jsonc'
const INGEST_TEMPLATE = 'ingest/wrangler.jsonc'
/** Each next to its template, so the paths inside (src/index.ts, ../migrations) mean the same */
export const UI_DEPLOY = 'wrangler.deploy.json'
export const INGEST_DEPLOY = 'ingest/wrangler.deploy.json'
/** What `nuxt build` generates from wrangler.jsonc, and what `wrangler deploy` uploads the UI from */
const UI_BUILT = '.output/server/wrangler.json'

export type Worker = 'ui' | 'ingest'

export interface DeployValues {
  databaseId: string
  /** Added to the names of both Workers and the database: what tells two deployments in one account apart */
  suffix?: string
  /** The hostname people sign in at */
  uiDomain: string
  /** The hostname httpdog POSTs to. The receiver's address follows from it: https://<it>/alerts */
  ingestDomain: string
  /** The one path of the UI that lets a browser in (shared/door.ts): the sign-in address is https://<uiDomain>/<it> */
  entryPath: string
  /** The piece of the receiver's address nobody would guess: httpdog POSTs to https://<ingestDomain>/<it>/alerts */
  ingestPath: string
  /** Settings of the receiver, as the whole numbers they are written as; undefined leaves the default of ingest/wrangler.jsonc */
  retentionDays?: string
  maxSkewSecs?: string
}

export interface WranglerConfig {
  name?: string
  assets?: { binding?: string; run_worker_first?: unknown; [key: string]: unknown }
  d1_databases?: { database_name?: string; database_id?: string }[]
  ratelimits?: { namespace_id?: string }[]
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
/** Short enough that the longer Worker name stays within the 63 characters a Worker's name may have */
const SUFFIX = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/

/** NAME_SUFFIX, checked. Read on its own before the database exists (scripts/setup.ts) */
export function readSuffix(env: Record<string, string>): string | undefined {
  const suffix = env.NAME_SUFFIX || undefined
  if (suffix && !SUFFIX.test(suffix)) throw new Error(`NAME_SUFFIX in ${LOCAL} is 1 to 32 of a-z, 0-9 and dash, not starting or ending with a dash`)
  return suffix
}

const withSuffix = (name: string | undefined, suffix: string | undefined) => (name && suffix ? `${name}-${suffix}` : name)

/**
 * A rate limiter's namespace_id for a deployment with a suffix. Limiters with the same id share
 * their counts across the account, so each deployment needs its own; this one follows from the
 * suffix (FNV-1a), which keeps it the same from one deploy to the next.
 */
export function limiterNamespace(base: string, suffix: string): string {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(`${base}:${suffix}`)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0
  return String(100_000 + (hash % 900_000))
}
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i

/** Said wherever the two hostnames are missing: by `make setup` before it starts, and by every deploy */
export const HOSTNAMES_NEEDED = `Two hostnames of your own are needed first. Put them in ${LOCAL}:

  UI_DOMAIN=alerts.example.com       where you sign in
  INGEST_DOMAIN=hook.example.com     where httpdog POSTs

Each is a name under a domain that is in this Cloudflare account, and that has no DNS record yet:
Cloudflare makes the record and the certificate. A deployment is never served from workers.dev.`

/**
 * The two hostnames of a deployment, checked. Both are required: there is no deployment without
 * them. Read on their own by scripts/setup.ts, before there is a database to name.
 */
export function readDomains(env: Record<string, string>): { uiDomain: string; ingestDomain: string } {
  const read = (name: 'UI_DOMAIN' | 'INGEST_DOMAIN') => {
    const value = env[name] ?? ''
    if (value && !HOSTNAME.test(value)) throw new Error(`${name} in ${LOCAL} must be a hostname alone, like alerts.example.com`)
    return value.toLowerCase()
  }
  const uiDomain = read('UI_DOMAIN')
  const ingestDomain = read('INGEST_DOMAIN')
  if (!uiDomain || !ingestDomain) throw new Error(HOSTNAMES_NEEDED)
  if (uiDomain === ingestDomain) throw new Error(`UI_DOMAIN and INGEST_DOMAIN in ${LOCAL} are the same. Each Worker needs a hostname of its own`)
  return { uiDomain, ingestDomain }
}

/** Where httpdog should POST: the one address the receiver answers at */
export const ingestUrl = (values: { ingestDomain: string; ingestPath: string }) => `https://${values.ingestDomain}/${values.ingestPath}/alerts`

/** Where a person goes to sign in: the one address of the UI that answers a browser it has not seen */
export const entryUrl = (values: { uiDomain: string; entryPath: string }) => `https://${values.uiDomain}/${values.entryPath}`

/** The values of deploy.local.env, checked. Throws with a message meant for the terminal */
export function readValues(env: Record<string, string>): DeployValues {
  const suffix = readSuffix(env)
  // the hostnames first: they are what a person has to decide, the rest setup fills in
  const { uiDomain, ingestDomain } = readDomains(env)
  const databaseId = env.DATABASE_ID ?? ''
  if (!databaseId || databaseId === PLACEHOLDER) throw new Error(`DATABASE_ID is not set in ${LOCAL}. For a first deployment, run \`make setup\`: it creates the database and fills it in`)
  if (!UUID.test(databaseId)) throw new Error(`DATABASE_ID in ${LOCAL} does not look like a D1 database id`)

  // Without it the UI would answer at its bare hostname, to anyone who comes across the name
  const entryPath = env.ENTRY_PATH ?? ''
  if (!entryPath) throw new Error(`ENTRY_PATH is not set in ${LOCAL}. \`make setup\` writes a new one and carries on from where a deployment is; or put a name of your own there that nobody would guess`)
  if (!isEntryPath(entryPath)) throw new Error(`ENTRY_PATH in ${LOCAL} must be 8 to 64 letters, digits, dashes and underscores: it is one piece of an address, https://<UI_DOMAIN>/<ENTRY_PATH>`)

  // The same for the receiver, which would otherwise take requests from anyone at /alerts
  const ingestPath = env.INGEST_PATH ?? ''
  if (!ingestPath) throw new Error(`INGEST_PATH is not set in ${LOCAL}. \`make setup\` writes a new one and carries on from where a deployment is; or put a name of your own there that nobody would guess. Hosts that already send alerts need the new address afterwards`)
  if (!isEntryPath(ingestPath)) throw new Error(`INGEST_PATH in ${LOCAL} must be 8 to 64 letters, digits, dashes and underscores: it is one piece of an address, https://<INGEST_DOMAIN>/<INGEST_PATH>/alerts`)

  // The receiver falls back to its default for a setting it cannot read, which would hide a typing
  // mistake until alerts were deleted sooner or later than meant. So a mistake stops the deploy here
  const wholeNumber = (name: 'RETENTION_DAYS' | 'MAX_SKEW_SECS', least: number, meaning: string) => {
    const value = env[name]
    if (!value) return undefined
    if (!/^\d{1,9}$/.test(value) || Number(value) < least) throw new Error(`${name} in ${LOCAL} must be a whole number of ${least} or more: ${meaning}`)
    return String(Number(value))
  }
  const retentionDays = wholeNumber('RETENTION_DAYS', 0, 'the days an alert is kept, or 0 to keep alerts forever')
  const maxSkewSecs = wholeNumber('MAX_SKEW_SECS', 1, "the seconds a request's timestamp may be from the receiver's clock")

  return { databaseId, suffix, uiDomain, ingestDomain, entryPath, ingestPath, retentionDays, maxSkewSecs }
}

/** A copy of a Worker's config with the values in place of the examples */
export function applyValues(config: WranglerConfig, values: DeployValues, worker: Worker): WranglerConfig {
  const { suffix } = values
  const result: WranglerConfig = {
    ...config,
    name: withSuffix(config.name, suffix),
    d1_databases: (config.d1_databases ?? []).map((database) => ({
      ...database,
      database_name: withSuffix(database.database_name, suffix),
      database_id: values.databaseId,
    })),
  }
  if (suffix && config.ratelimits) {
    result.ratelimits = config.ratelimits.map((limiter) => ({ ...limiter, namespace_id: limiterNamespace(limiter.namespace_id ?? '', suffix) }))
  }
  if (worker === 'ui') result.vars = { ...config.vars, INGEST_URL: ingestUrl(values), ENTRY_PATH: values.entryPath }
  if (worker === 'ingest') {
    result.vars = {
      ...config.vars,
      INGEST_PATH: values.ingestPath,
      ...(values.retentionDays ? { RETENTION_DAYS: values.retentionDays } : {}),
      ...(values.maxSkewSecs ? { MAX_SKEW_SECS: values.maxSkewSecs } : {}),
    }
  }
  // A Custom Domain: Cloudflare makes the DNS record and the certificate for the hostname. The
  // Worker answers there and nowhere else, so its workers.dev address and preview addresses are off
  result.routes = [{ pattern: worker === 'ui' ? values.uiDomain : values.ingestDomain, custom_domain: true }]
  result.workers_dev = false
  result.preview_urls = false
  return result
}

/** What the files of public/ are bound as in the built UI Worker (server/middleware/01.door.ts reads it) */
export const FILES_BINDING = 'FILES'

/**
 * The built config of the UI Worker with its files behind the door. Nitro's Worker entry hands a
 * file to whoever asks as soon as it finds a binding called ASSETS, before any middleware runs,
 * and Nitro writes that name into the config it generates. Under another name, every request
 * reaches the door first. Throws when the config would let files past it.
 */
export function behindTheDoor(built: WranglerConfig): WranglerConfig {
  if (built.assets?.run_worker_first !== true) {
    throw new Error('the built config does not send every request to the Worker first (assets.run_worker_first in wrangler.jsonc): the files of the UI would be handed to anyone')
  }
  return { ...built, assets: { ...built.assets, binding: FILES_BINDING } }
}

/** What makes a committed config no longer an example, or null when it still is one */
export function leak(config: WranglerConfig): string | null {
  if ((config.d1_databases ?? []).some((database) => database.database_id !== PLACEHOLDER)) return 'a real database_id'
  if (config.routes !== undefined) return 'routes'
  if (config.vars?.INGEST_URL !== undefined && !config.vars.INGEST_URL.includes('.example.')) return 'a real INGEST_URL'
  if (config.vars?.ENTRY_PATH !== undefined) return 'an entry path'
  if (config.vars?.INGEST_PATH !== undefined) return "the receiver's path"
  return null
}

function readTemplate(path: string): WranglerConfig {
  return Bun.JSONC.parse(readFileSync(resolve(ROOT, path), 'utf8')) as WranglerConfig
}

function readLocal(): Record<string, string> {
  return parseEnv(readFileSync(resolve(ROOT, LOCAL), 'utf8'))
}

/** The name a deployment's database is created with: the committed one, plus the suffix */
export function databaseName(suffix: string | undefined): string {
  return withSuffix(readTemplate(UI_TEMPLATE).d1_databases?.[0]?.database_name, suffix) ?? ''
}

function check(): DeployValues {
  for (const path of [UI_TEMPLATE, INGEST_TEMPLATE]) {
    const found = leak(readTemplate(path))
    if (found) throw new Error(`${path} has ${found}. That file is committed: move the value to ${LOCAL} and put the example back`)
  }
  if (!existsSync(resolve(ROOT, LOCAL))) throw new Error(`${LOCAL} is missing. For a first deployment, run \`make setup\`: it writes the file and says what to put in it`)
  return readValues(readLocal())
}

/** A line of an older file that is no longer read, said once so that it does not sit there misleading */
function noteOldLines() {
  if (readLocal().INGEST_URL) console.log(`note: INGEST_URL in ${LOCAL} is no longer read. The receiver's address is https://<INGEST_DOMAIN>/<INGEST_PATH>/alerts; the line can go`)
}

function write(path: string, config: WranglerConfig) {
  writeFileSync(resolve(ROOT, path), JSON.stringify(config, null, 2) + '\n')
}

if (import.meta.main) {
  const command = process.argv[2]
  try {
    if (command === 'check') {
      check()
      noteOldLines()
    } else if (command === 'configs') {
      const values = check()
      noteOldLines()
      const ui = applyValues(readTemplate(UI_TEMPLATE), values, 'ui')
      const ingest = applyValues(readTemplate(INGEST_TEMPLATE), values, 'ingest')
      // Said every time: with more than one deployment, this is how to see which one is about to change
      // (the entry path is left out: this line ends up in scrollback and in pasted logs)
      console.log(`${LOCAL}: ${ui.name} at ${values.uiDomain}, ${ingest.name} at ${values.ingestDomain}, database ${ingest.d1_databases?.[0]?.database_name}`)
      write(UI_DEPLOY, ui)
      write(INGEST_DEPLOY, ingest)
    } else if (command === 'entry') {
      const values = check()
      console.log(`sign in:        ${entryUrl(values)}`)
      console.log(`httpdog POSTs:  ${ingestUrl(values)}`)
    } else if (command === 'database-name') {
      console.log(databaseName(existsSync(resolve(ROOT, LOCAL)) ? readSuffix(readLocal()) : undefined))
    } else if (command === 'built') {
      if (!existsSync(resolve(ROOT, UI_BUILT))) throw new Error(`${UI_BUILT} is missing: \`nuxt build\` has not run`)
      write(UI_BUILT, behindTheDoor(JSON.parse(readFileSync(resolve(ROOT, UI_BUILT), 'utf8')) as WranglerConfig))
    } else if (command === 'ui') {
      const values = check()
      if (!existsSync(resolve(ROOT, UI_BUILT))) throw new Error(`${UI_BUILT} is missing: build the UI first (make deploy-ui does both)`)
      const built = JSON.parse(readFileSync(resolve(ROOT, UI_BUILT), 'utf8')) as WranglerConfig
      // again here, so that a config built some other way is not uploaded with its files in the open
      write(UI_BUILT, applyValues(behindTheDoor(built), values, 'ui'))
    } else {
      throw new Error('usage: bun scripts/deploy-config.ts check | configs | built | ui | database-name | entry')
    }
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
}
