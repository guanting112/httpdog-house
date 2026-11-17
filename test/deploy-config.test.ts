import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyValues, behindTheDoor, entryUrl, ingestUrl, leak, limiterNamespace, parseEnv, PLACEHOLDER, readDomains, readValues, type WranglerConfig } from '../scripts/deploy-config'

const ID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'
/** What every deployment has to have: its two hostnames */
const HOSTS = { UI_DOMAIN: 'alerts.example.com', INGEST_DOMAIN: 'hook.example.com' }
const ENTRY = 'a-name-nobody-would-guess'
/** A file that is complete */
const FILE = { ...HOSTS, DATABASE_ID: ID, ENTRY_PATH: ENTRY }
const VALUES = { databaseId: ID, uiDomain: 'alerts.example.com', ingestDomain: 'hook.example.com', entryPath: ENTRY }
const template = (path: string) => Bun.JSONC.parse(readFileSync(resolve(import.meta.dir, '..', path), 'utf8')) as WranglerConfig

describe('deploy.local.env', () => {
  test('reads KEY=value lines, skipping comments and blanks and dropping quotes', () => {
    expect(parseEnv(`# a comment\n\nDATABASE_ID=${ID}\nUI_DOMAIN="alerts.example.com"\n INGEST_DOMAIN = hook.example.com \nEMPTY=\n`)).toEqual({
      DATABASE_ID: ID,
      UI_DOMAIN: 'alerts.example.com',
      INGEST_DOMAIN: 'hook.example.com',
      EMPTY: '',
    })
  })

  test('needs a real database id', () => {
    expect(() => readValues({ ...HOSTS })).toThrow('DATABASE_ID is not set')
    expect(() => readValues({ ...HOSTS, DATABASE_ID: PLACEHOLDER })).toThrow('DATABASE_ID is not set')
    expect(() => readValues({ ...HOSTS, DATABASE_ID: 'httpdog-house' })).toThrow('does not look like')
    expect(readValues({ ...FILE, NAME_SUFFIX: '', RETENTION_DAYS: '', MAX_SKEW_SECS: '' })).toEqual(VALUES)
  })
})

describe('the two hostnames', () => {
  test('there is no deployment without both: nothing is read past them', () => {
    const incomplete: Record<string, string>[] = [{}, { UI_DOMAIN: 'alerts.example.com' }, { INGEST_DOMAIN: 'hook.example.com' }, { UI_DOMAIN: '', INGEST_DOMAIN: '' }]
    for (const env of incomplete) {
      expect(() => readDomains(env)).toThrow('Two hostnames of your own are needed first')
      // and the database id does not get a deploy past it
      expect(() => readValues({ ...env, DATABASE_ID: ID })).toThrow('Two hostnames of your own are needed first')
    }
  })

  test('what is said when they are missing names both values and rules out workers.dev', () => {
    const said = (() => {
      try {
        readDomains({})
      } catch (error) {
        return (error as Error).message
      }
    })()!
    expect(said).toContain('UI_DOMAIN=')
    expect(said).toContain('INGEST_DOMAIN=')
    expect(said).toContain('never served from workers.dev')
  })

  test('each is a hostname alone, and the two are different', () => {
    expect(() => readDomains({ ...HOSTS, UI_DOMAIN: 'https://alerts.example.com' })).toThrow('UI_DOMAIN')
    expect(() => readDomains({ ...HOSTS, INGEST_DOMAIN: 'hook.example.com/alerts' })).toThrow('INGEST_DOMAIN')
    expect(() => readDomains({ ...HOSTS, UI_DOMAIN: 'localhost' })).toThrow('UI_DOMAIN')
    expect(() => readDomains({ UI_DOMAIN: 'house.example.com', INGEST_DOMAIN: 'House.Example.com' })).toThrow('are the same')
    expect(readDomains({ UI_DOMAIN: 'Alerts.Example.com', INGEST_DOMAIN: 'hook.example.com' })).toEqual({ uiDomain: 'alerts.example.com', ingestDomain: 'hook.example.com' })
  })

  test('the address httpdog is given follows from the receiver hostname, and from nothing else', () => {
    expect(ingestUrl(VALUES)).toBe('https://hook.example.com/alerts')
    // a line left by an older file is not read
    const values = readValues({ ...FILE, INGEST_URL: 'https://httpdog-house-ingest.someone.workers.dev/alerts' })
    expect(applyValues(template('wrangler.jsonc'), values, 'ui').vars).toMatchObject({ INGEST_URL: 'https://hook.example.com/alerts' })
  })
})

describe('the entry path', () => {
  test('no deploy goes on without one: the UI would answer at its bare hostname', () => {
    const { ENTRY_PATH: _, ...without } = FILE
    expect(() => readValues(without)).toThrow('ENTRY_PATH is not set')
    expect(() => readValues({ ...FILE, ENTRY_PATH: '' })).toThrow('ENTRY_PATH is not set')
    for (const bad of ['short', 'two/parts-here', 'with space1']) expect(() => readValues({ ...FILE, ENTRY_PATH: bad })).toThrow('ENTRY_PATH')
  })

  test('the UI gets it, the receiver does not, and the sign-in address ends in it', () => {
    expect(applyValues(template('wrangler.jsonc'), VALUES, 'ui').vars).toEqual({ INGEST_URL: 'https://hook.example.com/alerts', ENTRY_PATH: ENTRY })
    expect(applyValues(template('ingest/wrangler.jsonc'), VALUES, 'ingest').vars).toEqual({ MAX_SKEW_SECS: '300', RETENTION_DAYS: '365' })
    expect(entryUrl(VALUES)).toBe(`https://alerts.example.com/${ENTRY}`)
  })

  test('the committed config asks for every request to reach the Worker first, and has no entry path', () => {
    const ui = template('wrangler.jsonc')
    expect(ui.assets).toEqual({ run_worker_first: true })
    expect(ui.vars?.ENTRY_PATH).toBeUndefined()
    expect(leak({ ...ui, vars: { ...ui.vars, ENTRY_PATH: ENTRY } })).toBe('an entry path')
  })

  test('the built config keeps its files behind the door, or is not deployed', () => {
    // as Nitro writes it: the binding it would hand files out through, before the door
    const built = { name: 'httpdog-house-ui', assets: { run_worker_first: true, binding: 'ASSETS', directory: '../public' } }
    expect(behindTheDoor(built).assets).toEqual({ run_worker_first: true, binding: 'FILES', directory: '../public' })
    expect(behindTheDoor(behindTheDoor(built))).toEqual(behindTheDoor(built))
    expect(() => behindTheDoor({ name: 'x', assets: { binding: 'ASSETS', directory: '../public' } })).toThrow('handed to anyone')
    expect(() => behindTheDoor({ name: 'x' })).toThrow('handed to anyone')
  })
})

describe('a second deployment in one account', () => {
  test('NAME_SUFFIX is a short lowercase name', () => {
    expect(readValues({ ...FILE, NAME_SUFFIX: 'team-a' }).suffix).toBe('team-a')
    expect(readValues({ ...FILE, NAME_SUFFIX: '' }).suffix).toBeUndefined()
    for (const bad of ['Team', 'team_a', '-team', 'team-', 'a'.repeat(33)]) {
      expect(() => readValues({ ...FILE, NAME_SUFFIX: bad })).toThrow('NAME_SUFFIX')
    }
  })

  test('the suffix names both Workers, the database and the rate limiter apart', () => {
    const values = { ...VALUES, suffix: 'team-a' }
    const ui = applyValues(template('wrangler.jsonc'), values, 'ui')
    const ingest = applyValues(template('ingest/wrangler.jsonc'), values, 'ingest')

    expect([ui.name, ingest.name]).toEqual(['httpdog-house-ui-team-a', 'httpdog-house-ingest-team-a'])
    // the longest suffix still leaves the longer name within what a Worker's name may be
    expect('httpdog-house-ingest-'.length + 32).toBeLessThanOrEqual(63)
    expect([ui.d1_databases![0]!.database_name, ingest.d1_databases![0]!.database_name]).toEqual(['httpdog-house-team-a', 'httpdog-house-team-a'])

    const namespace = ui.ratelimits![0]!.namespace_id!
    expect(namespace).toMatch(/^[1-9]\d{5}$/)
    expect(namespace).not.toBe(template('wrangler.jsonc').ratelimits![0]!.namespace_id)
    expect(namespace).toBe(limiterNamespace('7301', 'team-a'))
    expect(namespace).not.toBe(limiterNamespace('7301', 'team-b'))
  })

  test('without a suffix the names are the ones in the committed configs', () => {
    const ui = applyValues(template('wrangler.jsonc'), VALUES, 'ui')
    expect(ui.name).toBe('httpdog-house-ui')
    expect(ui.d1_databases![0]!.database_name).toBe('httpdog-house')
    expect(ui.ratelimits).toEqual(template('wrangler.jsonc').ratelimits)
  })
})

describe('generated configs', () => {
  test('the committed configs are examples', () => {
    expect(leak(template('wrangler.jsonc'))).toBeNull()
    expect(leak(template('ingest/wrangler.jsonc'))).toBeNull()
  })

  test('a committed config with something real in it is caught', () => {
    const ui = template('wrangler.jsonc')
    expect(leak({ ...ui, d1_databases: [{ ...ui.d1_databases![0], database_id: ID }] })).toBe('a real database_id')
    expect(leak({ ...ui, routes: [{ pattern: 'alerts.example.com', custom_domain: true }] })).toBe('routes')
    expect(leak({ ...ui, vars: { INGEST_URL: 'https://hook.mycompany.test/alerts' } })).toBe('a real INGEST_URL')
    // and so is a config as a deploy makes it
    expect(leak(applyValues(ui, VALUES, 'ui'))).not.toBeNull()
  })

  test('each Worker is served from its own hostname and from nowhere else', () => {
    const ui = applyValues(template('wrangler.jsonc'), VALUES, 'ui')
    expect(ui.d1_databases![0]!.database_id).toBe(ID)
    expect(ui.vars).toEqual({ INGEST_URL: 'https://hook.example.com/alerts', ENTRY_PATH: ENTRY })
    expect(ui.routes).toEqual([{ pattern: 'alerts.example.com', custom_domain: true }])
    expect([ui.workers_dev, ui.preview_urls]).toEqual([false, false])

    const ingest = applyValues(template('ingest/wrangler.jsonc'), VALUES, 'ingest')
    expect(ingest.d1_databases![0]!.database_id).toBe(ID)
    expect(ingest.vars).toEqual({ MAX_SKEW_SECS: '300', RETENTION_DAYS: '365' })
    expect(ingest.routes).toEqual([{ pattern: 'hook.example.com', custom_domain: true }])
    expect([ingest.workers_dev, ingest.preview_urls]).toEqual([false, false])
  })

  test('the committed config is left as it was', () => {
    const ingest = template('ingest/wrangler.jsonc')
    const before = structuredClone(ingest)
    applyValues(ingest, VALUES, 'ingest')
    expect(ingest).toEqual(before)
  })

  test('the receiver gets its settings, and keeps its defaults for those left empty', () => {
    const ingestVars = (env: Record<string, string>) => applyValues(template('ingest/wrangler.jsonc'), readValues({ ...FILE, ...env }), 'ingest').vars
    expect(ingestVars({ RETENTION_DAYS: '', MAX_SKEW_SECS: '' })).toEqual({ MAX_SKEW_SECS: '300', RETENTION_DAYS: '365' })
    expect(ingestVars({ RETENTION_DAYS: '30' })).toEqual({ MAX_SKEW_SECS: '300', RETENTION_DAYS: '30' })
    expect(ingestVars({ RETENTION_DAYS: '0', MAX_SKEW_SECS: '0600' })).toEqual({ MAX_SKEW_SECS: '600', RETENTION_DAYS: '0' })
    // they are the receiver's alone
    expect(applyValues(template('wrangler.jsonc'), readValues({ ...FILE, RETENTION_DAYS: '30' }), 'ui').vars).toEqual({ INGEST_URL: 'https://hook.example.com/alerts', ENTRY_PATH: ENTRY })
  })

  test('a setting that is not a whole number stops the deploy, since the receiver would quietly use its default', () => {
    for (const bad of ['30d', '-1', '1.5', 'forever', '1e3']) {
      expect(() => readValues({ ...FILE, RETENTION_DAYS: bad })).toThrow('RETENTION_DAYS')
    }
    expect(() => readValues({ ...FILE, MAX_SKEW_SECS: '0' })).toThrow('MAX_SKEW_SECS')
    expect(() => readValues({ ...FILE, MAX_SKEW_SECS: '5m' })).toThrow('MAX_SKEW_SECS')
  })
})
