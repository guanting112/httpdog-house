import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyValues, leak, limiterNamespace, parseEnv, PLACEHOLDER, readValues, type WranglerConfig } from '../scripts/deploy-config'

const ID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'
const template = (path: string) => Bun.JSONC.parse(readFileSync(resolve(import.meta.dir, '..', path), 'utf8')) as WranglerConfig

describe('deploy.local.env', () => {
  test('reads KEY=value lines, skipping comments and blanks and dropping quotes', () => {
    expect(parseEnv(`# a comment\n\nDATABASE_ID=${ID}\nUI_DOMAIN="alerts.example.com"\n INGEST_URL = https://h.example.com/alerts?a=b \nEMPTY=\n`)).toEqual({
      DATABASE_ID: ID,
      UI_DOMAIN: 'alerts.example.com',
      INGEST_URL: 'https://h.example.com/alerts?a=b',
      EMPTY: '',
    })
  })

  test('needs a real database id', () => {
    expect(() => readValues({})).toThrow('DATABASE_ID is not set')
    expect(() => readValues({ DATABASE_ID: PLACEHOLDER })).toThrow('DATABASE_ID is not set')
    expect(() => readValues({ DATABASE_ID: 'httpdog-house' })).toThrow('does not look like')
    expect(readValues({ DATABASE_ID: ID, UI_DOMAIN: '', INGEST_DOMAIN: '', INGEST_URL: '' })).toEqual({ databaseId: ID })
  })

  test('takes hostnames alone and an address ending in /alerts', () => {
    expect(() => readValues({ DATABASE_ID: ID, UI_DOMAIN: 'https://alerts.example.com' })).toThrow('UI_DOMAIN')
    expect(() => readValues({ DATABASE_ID: ID, INGEST_DOMAIN: 'hook.example.com/alerts' })).toThrow('INGEST_DOMAIN')
    expect(() => readValues({ DATABASE_ID: ID, INGEST_URL: 'https://hook.example.com' })).toThrow('INGEST_URL')
    expect(() => readValues({ DATABASE_ID: ID, INGEST_URL: 'hook.example.com/alerts' })).toThrow('INGEST_URL')
  })

  test('the receiver address follows INGEST_DOMAIN unless INGEST_URL says otherwise', () => {
    expect(readValues({ DATABASE_ID: ID, INGEST_DOMAIN: 'hook.example.com' }).ingestUrl).toBe('https://hook.example.com/alerts')
    expect(readValues({ DATABASE_ID: ID, INGEST_DOMAIN: 'hook.example.com', INGEST_URL: 'https://other.example.com/alerts' }).ingestUrl).toBe(
      'https://other.example.com/alerts',
    )
  })
})

describe('a second deployment in one account', () => {
  test('NAME_SUFFIX is a short lowercase name', () => {
    expect(readValues({ DATABASE_ID: ID, NAME_SUFFIX: 'team-a' }).suffix).toBe('team-a')
    expect(readValues({ DATABASE_ID: ID, NAME_SUFFIX: '' }).suffix).toBeUndefined()
    for (const bad of ['Team', 'team_a', '-team', 'team-', 'a'.repeat(33)]) {
      expect(() => readValues({ DATABASE_ID: ID, NAME_SUFFIX: bad })).toThrow('NAME_SUFFIX')
    }
  })

  test('the suffix names both Workers, the database and the rate limiter apart', () => {
    const values = { databaseId: ID, suffix: 'team-a' }
    const ui = applyValues(template('wrangler.jsonc'), values, 'ui')
    const ingest = applyValues(template('ingest/wrangler.jsonc'), values, 'ingest')

    expect([ui.name, ingest.name]).toEqual(['httpdog-house-ui-team-a', 'httpdog-house-ingest-team-a'])
    expect(ingest.name!.length + 'a'.repeat(32).length - 'team-a'.length).toBeLessThanOrEqual(63)
    expect([ui.d1_databases![0]!.database_name, ingest.d1_databases![0]!.database_name]).toEqual(['httpdog-house-team-a', 'httpdog-house-team-a'])

    const namespace = ui.ratelimits![0]!.namespace_id!
    expect(namespace).toMatch(/^[1-9]\d{5}$/)
    expect(namespace).not.toBe(template('wrangler.jsonc').ratelimits![0]!.namespace_id)
    expect(namespace).toBe(limiterNamespace('7301', 'team-a'))
    expect(namespace).not.toBe(limiterNamespace('7301', 'team-b'))
  })

  test('without a suffix the names are the ones in the committed configs', () => {
    const ui = applyValues(template('wrangler.jsonc'), { databaseId: ID }, 'ui')
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
    expect(leak(applyValues(ui, { databaseId: ID }, 'ui'))).toBe('a real database_id')
    expect(leak({ ...ui, routes: [{ pattern: 'alerts.example.com', custom_domain: true }] })).toBe('routes')
    expect(leak({ ...ui, vars: { INGEST_URL: 'https://hook.mycompany.test/alerts' } })).toBe('a real INGEST_URL')
  })

  test('on workers.dev only the database id changes, and the template is left alone', () => {
    const ingest = template('ingest/wrangler.jsonc')
    const before = structuredClone(ingest)
    const result = applyValues(ingest, { databaseId: ID }, 'ingest')
    expect(ingest).toEqual(before)
    expect(result).toEqual({ ...before, d1_databases: [{ ...before.d1_databases![0], database_id: ID }] })
  })

  test('each Worker gets its own hostname, and only the UI gets INGEST_URL', () => {
    const values = { databaseId: ID, ingestUrl: 'https://hook.example.com/alerts', uiDomain: 'alerts.example.com', ingestDomain: 'hook.example.com' }

    const ui = applyValues(template('wrangler.jsonc'), values, 'ui')
    expect(ui.d1_databases![0]!.database_id).toBe(ID)
    expect(ui.vars).toEqual({ INGEST_URL: 'https://hook.example.com/alerts' })
    expect(ui.routes).toEqual([{ pattern: 'alerts.example.com', custom_domain: true }])
    expect([ui.workers_dev, ui.preview_urls]).toEqual([false, false])

    const ingest = applyValues(template('ingest/wrangler.jsonc'), values, 'ingest')
    expect(ingest.d1_databases![0]!.database_id).toBe(ID)
    expect(ingest.vars).toEqual({ MAX_SKEW_SECS: '300', RETENTION_DAYS: '90' })
    expect(ingest.routes).toEqual([{ pattern: 'hook.example.com', custom_domain: true }])
  })
})
