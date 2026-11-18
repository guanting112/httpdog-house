import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyValues, behindTheDoor, deploymentNames, entryUrl, ingestUrl, leak, limiterNamespace, otherDeployments, parseEnv, PLACEHOLDER, readDomains, readSuffix, readValues, sharedWith, suffixOf, type WranglerConfig } from '../scripts/deploy-config'

const ID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'
/** What every deployment has to have: its two hostnames */
const HOSTS = { UI_DOMAIN: 'alerts.example.com', INGEST_DOMAIN: 'hook.example.com' }
const ENTRY = 'a-name-nobody-would-guess'
const INGEST = 'another-name-not-to-guess'
/** Where httpdog POSTs, with those */
const ADDRESS = `https://hook.example.com/${INGEST}/alerts`
/** A file that is complete */
const FILE = { ...HOSTS, DATABASE_ID: ID, ENTRY_PATH: ENTRY, INGEST_PATH: INGEST }
const VALUES = { databaseId: ID, uiDomain: 'alerts.example.com', ingestDomain: 'hook.example.com', entryPath: ENTRY, ingestPath: INGEST }
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

  test('the address httpdog is given follows from the receiver hostname and its path, and from nothing else', () => {
    expect(ingestUrl(VALUES)).toBe(ADDRESS)
    // a line left by an older file is not read
    const values = readValues({ ...FILE, INGEST_URL: 'https://httpdog-house-ingest.someone.workers.dev/alerts' })
    expect(applyValues(template('wrangler.jsonc'), values, 'ui').vars).toMatchObject({ INGEST_URL: ADDRESS })
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
    expect(applyValues(template('wrangler.jsonc'), VALUES, 'ui').vars).toEqual({ INGEST_URL: ADDRESS, ENTRY_PATH: ENTRY })
    expect(applyValues(template('ingest/wrangler.jsonc'), VALUES, 'ingest').vars).toEqual({ MAX_SKEW_SECS: '300', RETENTION_DAYS: '365', INGEST_PATH: INGEST })
    expect(entryUrl(VALUES)).toBe(`https://alerts.example.com/${ENTRY}`)
  })

  test('the receiver has a path of its own, and no deploy goes on without it: it would take requests from anyone at /alerts', () => {
    const { INGEST_PATH: _, ...without } = FILE
    expect(() => readValues(without)).toThrow('INGEST_PATH is not set')
    for (const bad of ['short', 'two/parts-here', 'alerts']) expect(() => readValues({ ...FILE, INGEST_PATH: bad })).toThrow('INGEST_PATH')
    // the receiver is told its path, the UI only the whole address to show
    expect(applyValues(template('ingest/wrangler.jsonc'), VALUES, 'ingest').vars?.INGEST_PATH).toBe(INGEST)
    expect(applyValues(template('wrangler.jsonc'), VALUES, 'ui').vars?.INGEST_PATH).toBeUndefined()
    // and the committed config has none
    const ingest = template('ingest/wrangler.jsonc')
    expect(ingest.vars?.INGEST_PATH).toBeUndefined()
    expect(leak({ ...ingest, vars: { ...ingest.vars, INGEST_PATH: INGEST } })).toBe("the receiver's path")
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
  test("the suffix is the file's name: none for deploy.local.env, <name> for deploy.<name>.env", () => {
    expect(suffixOf('deploy.local.env')).toBeUndefined()
    expect(suffixOf('deploy.team-a.env')).toBe('team-a')
    expect(suffixOf('/somewhere/else/deploy.team-a.env')).toBe('team-a')
    expect(suffixOf(`deploy.${'a'.repeat(32)}.env`)).toBe('a'.repeat(32))
    expect(readValues(FILE, 'deploy.team-a.env').suffix).toBe('team-a')
    expect(readValues(FILE, 'deploy.local.env').suffix).toBeUndefined()
  })

  test('a file under another name is not a deployment, and a name that cannot go on the end of a Worker is refused', () => {
    // a name of another shape is also one .gitignore does not keep out of the repository
    for (const bad of ['team-a.env', 'deploy.local.env.example', 'deploy.env', 'deploy..env', '.env']) expect(() => suffixOf(bad)).toThrow("not the name of a deployment's file")
    for (const bad of ['Team', 'team_a', '-team', 'team-', 'a.b', 'a'.repeat(33)]) expect(() => suffixOf(`deploy.${bad}.env`)).toThrow('1 to 32 of a-z, 0-9 and dash')
    expect(() => readValues(FILE, 'deploy.Team.env')).toThrow('1 to 32')
  })

  test('a NAME_SUFFIX left in an older file is no longer read, and stops everything when the file name says otherwise', () => {
    expect(readSuffix('deploy.team-a.env', { NAME_SUFFIX: 'team-a' })).toBe('team-a')
    expect(readSuffix('deploy.local.env', { NAME_SUFFIX: '' })).toBeUndefined()
    // its Workers and database are named by it already: the name alone would make a new deployment beside them
    expect(() => readSuffix('deploy.local.env', { NAME_SUFFIX: 'team-a' })).toThrow('rename the file deploy.team-a.env')
    expect(() => readSuffix('deploy.team-b.env', { NAME_SUFFIX: 'team-a' })).toThrow('DEPLOY_ENV=deploy.team-a.env')
    expect(() => readValues({ ...FILE, NAME_SUFFIX: 'team-a' }, 'deploy.local.env')).toThrow('NAME_SUFFIX=team-a')
  })

  test("the names said before a deployment is set up are the ones its configs get", () => {
    for (const suffix of [undefined, 'team-a']) {
      const values = { ...VALUES, suffix }
      const ui = applyValues(template('wrangler.jsonc'), values, 'ui')
      const ingest = applyValues(template('ingest/wrangler.jsonc'), values, 'ingest')
      expect(deploymentNames(suffix)).toEqual({ ui: ui.name!, ingest: ingest.name!, database: ingest.d1_databases![0]!.database_name! })
    }
    expect(deploymentNames('team-a')).toEqual({ ui: 'httpdog-house-ui-team-a', ingest: 'httpdog-house-ingest-team-a', database: 'httpdog-house-team-a' })
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

describe('two deployments in one checkout', () => {
  const FIRST = { ...FILE }
  const SECOND = { UI_DOMAIN: 'team-a.example.com', INGEST_DOMAIN: 'hook-a.example.com', DATABASE_ID: '11111111-2222-3333-4444-555555555555' }
  const first = [{ file: 'deploy.local.env', env: FIRST }]

  test('two that share nothing go on side by side', () => {
    expect(sharedWith('deploy.team-a.env', SECOND, first)).toBeNull()
    // nor does a file that has no database yet, nor one with the example's id
    expect(sharedWith('deploy.team-a.env', { ...SECOND, DATABASE_ID: '' }, [{ file: 'deploy.team-b.env', env: { ...SECOND, UI_DOMAIN: 'b.example.com', INGEST_DOMAIN: 'hook-b.example.com', DATABASE_ID: '' } }])).toBeNull()
    expect(sharedWith('deploy.team-a.env', { ...SECOND, DATABASE_ID: PLACEHOLDER }, [{ file: 'deploy.local.env', env: { ...FIRST, DATABASE_ID: PLACEHOLDER } }])).toBeNull()
  })

  test("a file copied from another deployment's is caught by its database, whichever of the two is read", () => {
    const copied = { ...FIRST, UI_DOMAIN: 'team-a.example.com', INGEST_DOMAIN: 'hook-a.example.com' }
    expect(sharedWith('deploy.team-a.env', copied, first)).toContain('deploy.team-a.env and deploy.local.env have the same DATABASE_ID')
    expect(sharedWith('deploy.local.env', FIRST, [{ file: 'deploy.team-a.env', env: copied }])).toContain('Start that one again from deploy.local.env.example')
  })

  test('a hostname in two files is caught, whichever Worker each is for', () => {
    expect(sharedWith('deploy.team-a.env', { ...SECOND, UI_DOMAIN: 'ALERTS.example.com' }, first)).toBe('alerts.example.com is in both deploy.team-a.env and deploy.local.env. Each deployment is served from two hostnames of its own')
    expect(sharedWith('deploy.team-a.env', { ...SECOND, INGEST_DOMAIN: 'alerts.example.com' }, first)).toContain('alerts.example.com is in both')
  })

  test("the other deployments are the other deploy.<name>.env files, never this one or the example", () => {
    const files: Record<string, string> = { 'deploy.local.env': 'UI_DOMAIN=alerts.example.com\n', 'deploy.team-a.env': 'UI_DOMAIN=team-a.example.com\n', 'deploy.local.env.example': '', 'README.md': '', '.dev.vars': '' }
    const others = otherDeployments('deploy.team-a.env', Object.keys(files), (name) => files[name] ?? null)
    expect(others).toEqual([{ file: 'deploy.local.env', env: { UI_DOMAIN: 'alerts.example.com' } }])
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
    expect(ui.vars).toEqual({ INGEST_URL: ADDRESS, ENTRY_PATH: ENTRY })
    expect(ui.routes).toEqual([{ pattern: 'alerts.example.com', custom_domain: true }])
    expect([ui.workers_dev, ui.preview_urls]).toEqual([false, false])

    const ingest = applyValues(template('ingest/wrangler.jsonc'), VALUES, 'ingest')
    expect(ingest.d1_databases![0]!.database_id).toBe(ID)
    expect(ingest.vars).toEqual({ MAX_SKEW_SECS: '300', RETENTION_DAYS: '365', INGEST_PATH: INGEST })
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
    expect(ingestVars({ RETENTION_DAYS: '', MAX_SKEW_SECS: '' })).toEqual({ MAX_SKEW_SECS: '300', RETENTION_DAYS: '365', INGEST_PATH: INGEST })
    expect(ingestVars({ RETENTION_DAYS: '30' })).toEqual({ MAX_SKEW_SECS: '300', RETENTION_DAYS: '30', INGEST_PATH: INGEST })
    expect(ingestVars({ RETENTION_DAYS: '0', MAX_SKEW_SECS: '0600' })).toEqual({ MAX_SKEW_SECS: '600', RETENTION_DAYS: '0', INGEST_PATH: INGEST })
    // they are the receiver's alone
    expect(applyValues(template('wrangler.jsonc'), readValues({ ...FILE, RETENTION_DAYS: '30' }), 'ui').vars).toEqual({ INGEST_URL: ADDRESS, ENTRY_PATH: ENTRY })
  })

  test('a setting that is not a whole number stops the deploy, since the receiver would quietly use its default', () => {
    for (const bad of ['30d', '-1', '1.5', 'forever', '1e3']) {
      expect(() => readValues({ ...FILE, RETENTION_DAYS: bad })).toThrow('RETENTION_DAYS')
    }
    expect(() => readValues({ ...FILE, MAX_SKEW_SECS: '0' })).toThrow('MAX_SKEW_SECS')
    expect(() => readValues({ ...FILE, MAX_SKEW_SECS: '5m' })).toThrow('MAX_SKEW_SECS')
  })
})
