import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { INGEST_DEPLOY, LOCAL, LOCAL_EXAMPLE, parseEnv, UI_DEPLOY } from '../scripts/deploy-config'
import { findDatabase, readCount, setEnvValue, setup, SetupError, type Shell, workersDevUrl } from '../scripts/setup'

const ID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'
const EXAMPLE = readFileSync(resolve(import.meta.dir, '..', LOCAL_EXAMPLE), 'utf8')
const deployed = (...targets: string[]) => JSON.stringify({ type: 'deploy', version: 1, targets }) + '\n'

/** A Cloudflare account and a terminal that exist only here. `ran` is every command that was shown on the terminal */
function account(start: {
  file?: string
  loggedIn?: boolean
  databases?: { name: string; uuid: string }[]
  keyOn?: string[]
  admins?: number
  signingKeys?: number
  failing?: string
  noTerminal?: boolean
  /** The accounts the login can reach. One, unless a test says otherwise */
  accounts?: { name: string; id: string }[]
  /** CLOUDFLARE_ACCOUNT_ID of the environment */
  accountId?: string
  /** What is typed when asked whether this is the account. Yes, unless a test says otherwise */
  confirm?: string
  /** What is typed, in turn, when asked for the admin's name */
  names?: string[]
}) {
  const state = {
    files: { [LOCAL_EXAMPLE]: EXAMPLE, ...(start.file === undefined ? {} : { [LOCAL]: start.file }) } as Record<string, string>,
    loggedIn: start.loggedIn ?? true,
    databases: start.databases ?? [],
    keyOn: start.keyOn ?? [],
    admins: start.admins ?? 0,
    ran: [] as string[],
    said: [] as string[],
    /** How many times a username was asked for */
    asked: 0,
    /** The questions about the account, as they were put */
    confirmations: [] as string[],
  }
  const login = { loggedIn: true, email: 'someone@example.com', accounts: start.accounts ?? [{ name: "Someone's Account", id: 'a'.repeat(32) }] }
  const shell: Shell = {
    async run(command) {
      const line = command.join(' ')
      state.ran.push(line)
      if (start.failing && line.includes(start.failing)) return { code: 1, output: '' }
      if (line === 'bunx wrangler login') state.loggedIn = true
      if (line.startsWith('bunx wrangler d1 create ')) state.databases.push({ name: command[4]!, uuid: ID })
      if (line.startsWith('make --no-print-directory secrets')) state.keyOn = [INGEST_DEPLOY, UI_DEPLOY]
      if (line.startsWith('bun scripts/create-admin.ts ')) state.admins++
      if (line.endsWith(' deploy-ingest')) return { code: 0, output: deployed('https://httpdog-house-ingest.someone.workers.dev', 'schedule: 17 3 * * *') }
      if (line.endsWith(' deploy-ui')) return { code: 0, output: deployed('https://httpdog-house-ui.someone.workers.dev') }
      return { code: 0, output: '' }
    },
    async capture(command) {
      const line = command.join(' ')
      const ok = (stdout: string) => ({ code: 0, stdout, stderr: '' })
      if (line === 'bunx wrangler whoami --json') return state.loggedIn ? ok(JSON.stringify(login)) : { code: 1, stdout: '{"loggedIn":false}', stderr: '' }
      if (line === 'bunx wrangler d1 list --json') return ok(JSON.stringify(state.databases))
      if (line.startsWith('bunx wrangler secret list -c ')) return ok(state.keyOn.includes(command[5]!) ? '[{"name":"SECRETS_KEY","type":"secret_text"}]' : '[]')
      if (line.includes('FROM signing_keys')) return ok(JSON.stringify([{ results: [{ n: start.signingKeys ?? 0 }], success: true }]))
      if (line.includes('FROM users')) return ok(JSON.stringify([{ results: [{ n: state.admins }], success: true }]))
      throw new Error(`a command the test did not expect: ${line}`)
    },
    ask(question) {
      if (start.noTerminal) return null
      if (question.includes('Set up httpdog-house in')) {
        state.confirmations.push(question)
        return start.confirm ?? 'y'
      }
      return (start.names ?? ['Not A Name', 'guanting'])[state.asked++] ?? 'guanting'
    },
    accountId: start.accountId,
    log: (line) => void state.said.push(line),
    read: (path) => state.files[path] ?? null,
    write: (path, text) => void (state.files[path] = text),
  }
  return { state, shell }
}

describe('what setup reads', () => {
  test('a value is set in place, or added when the file has no line for it', () => {
    expect(setEnvValue('# a comment\nDATABASE_ID=\nUI_DOMAIN=\n', 'DATABASE_ID', ID)).toBe(`# a comment\nDATABASE_ID=${ID}\nUI_DOMAIN=\n`)
    expect(setEnvValue('UI_DOMAIN=a.example.com', 'INGEST_URL', 'https://h.example.com/alerts')).toBe('UI_DOMAIN=a.example.com\nINGEST_URL=https://h.example.com/alerts\n')
    expect(parseEnv(setEnvValue(EXAMPLE, 'DATABASE_ID', ID)).DATABASE_ID).toBe(ID)
  })

  // Found by test/fuzz.test.ts
  test('a value is written as it is, over the whole line, on every line for the key', () => {
    expect(setEnvValue('INGEST_URL=old\n', 'INGEST_URL', "https://h.example.com/alerts?a=$&b=$'")).toBe("INGEST_URL=https://h.example.com/alerts?a=$&b=$'\n")
    expect(setEnvValue('INGEST_URL=old\rstill the same line\nUI_DOMAIN=\n', 'INGEST_URL', 'new')).toBe('INGEST_URL=new\nUI_DOMAIN=\n')
    expect(parseEnv(setEnvValue('DATABASE_ID=\n# again, by hand\nDATABASE_ID=\n', 'DATABASE_ID', ID)).DATABASE_ID).toBe(ID)
  })

  test('the database is found by its exact name', () => {
    const list = JSON.stringify([
      { uuid: 'other', name: 'httpdog-house-team-a' },
      { uuid: ID, name: 'httpdog-house' },
    ])
    expect(findDatabase(list, 'httpdog-house')).toBe(ID)
    expect(findDatabase(list, 'httpdog')).toBeUndefined()
    expect(findDatabase('not json', 'httpdog-house')).toBeUndefined()
  })

  test('the workers.dev address is taken from the deploy wrangler reported', () => {
    const output = '{"type":"wrangler-session","version":1}\n' + deployed('schedule: 17 3 * * *', 'https://httpdog-house-ingest.someone.workers.dev')
    expect(workersDevUrl(output)).toBe('https://httpdog-house-ingest.someone.workers.dev')
    expect(workersDevUrl(deployed('hook.example.com (custom domain)'))).toBeUndefined()
    expect(workersDevUrl('')).toBeUndefined()
  })

  test('a count is read from the one row', () => {
    expect(readCount('[{"results":[{"n":3}],"success":true}]')).toBe(3)
    expect(readCount('[{"results":[],"success":true}]')).toBeUndefined()
    expect(readCount('Error')).toBeUndefined()
  })
})

describe('make setup', () => {
  test('on a new account it does everything, in order, and fills in the file', async () => {
    const { state, shell } = account({ loggedIn: false })
    const result = await setup(shell)

    expect(state.ran).toEqual([
      'bunx wrangler login',
      'bunx wrangler d1 create httpdog-house --update-config=false',
      'make --no-print-directory db-migrate',
      'make --no-print-directory deploy-ingest',
      'make --no-print-directory deploy-ui',
      'make --no-print-directory secrets',
      'bun scripts/create-admin.ts guanting --remote',
    ])
    const file = parseEnv(state.files[LOCAL]!)
    expect(file.DATABASE_ID).toBe(ID)
    expect(file.INGEST_URL).toBe('https://httpdog-house-ingest.someone.workers.dev/alerts')
    expect(result).toEqual({ ui: 'https://httpdog-house-ui.someone.workers.dev', receiver: 'https://httpdog-house-ingest.someone.workers.dev/alerts' })
    // a name the UI would refuse is asked for again
    expect(state.asked).toBe(2)
  })

  test('run again, it only brings the deployment up to date', async () => {
    const file = setEnvValue(setEnvValue(EXAMPLE, 'DATABASE_ID', ID), 'INGEST_URL', 'https://httpdog-house-ingest.someone.workers.dev/alerts')
    const { state, shell } = account({ file, databases: [{ name: 'httpdog-house', uuid: ID }], keyOn: [INGEST_DEPLOY, UI_DEPLOY], admins: 1 })
    await setup(shell)

    expect(state.ran).toEqual(['make --no-print-directory db-migrate', 'make --no-print-directory deploy-ingest', 'make --no-print-directory deploy-ui'])
    expect(state.files[LOCAL]).toBe(file)
    expect(state.asked).toBe(0)
  })

  test('a database of that name that the account already has is used, not created again', async () => {
    const { state, shell } = account({ databases: [{ name: 'httpdog-house', uuid: ID }] })
    await setup(shell)
    expect(state.ran.some((line) => line.includes('d1 create'))).toBe(false)
    expect(parseEnv(state.files[LOCAL]!).DATABASE_ID).toBe(ID)
  })

  test('a second deployment gets its own database name', async () => {
    const { state, shell } = account({ file: setEnvValue(EXAMPLE, 'NAME_SUFFIX', 'team-a') })
    await setup(shell)
    expect(state.ran).toContain('bunx wrangler d1 create httpdog-house-team-a --update-config=false')
  })

  test('with a hostname of your own, the addresses come from the file', async () => {
    const file = setEnvValue(setEnvValue(EXAMPLE, 'INGEST_DOMAIN', 'hook.example.com'), 'UI_DOMAIN', 'alerts.example.com')
    const { state, shell } = account({ file })
    const result = await setup(shell)
    expect(parseEnv(state.files[LOCAL]!).INGEST_URL).toBe('')
    expect(result).toEqual({ ui: 'https://alerts.example.com', receiver: 'https://hook.example.com/alerts' })
  })

  test('a step that fails stops there, and what was done is kept for the next run', async () => {
    const { state, shell } = account({ failing: 'deploy-ingest' })
    await expect(setup(shell)).rejects.toBeInstanceOf(SetupError)
    expect(state.ran.at(-1)).toBe('make --no-print-directory deploy-ingest')
    expect(parseEnv(state.files[LOCAL]!).DATABASE_ID).toBe(ID)
  })

  test('it says who is logged in and which account, and waits for a yes', async () => {
    const { state, shell } = account({})
    await setup(shell)
    expect(state.confirmations).toEqual([`Logged in as someone@example.com. Set up httpdog-house in "Someone's Account"? (y/n): `])
  })

  test('anything but a yes stops it before a command is run or a file is written', async () => {
    for (const confirm of ['n', '', 'no', 'maybe']) {
      const { state, shell } = account({ confirm })
      await expect(setup(shell)).rejects.toThrow('Stopped before changing anything')
      expect(state.ran).toEqual([])
      expect(state.files[LOCAL]).toBeUndefined()
    }
  })

  // Found on a real run: an Enter pressed during an earlier step came out as an empty answer here,
  // and an empty answer was taken for having no terminal
  test('an empty answer to the name is asked again, not taken for nobody being there', async () => {
    const { state, shell } = account({ names: ['', '   ', 'ops'] })
    await setup(shell)
    expect(state.asked).toBe(3)
    expect(state.ran.at(-1)).toBe('bun scripts/create-admin.ts ops --remote')
  })

  test('after five answers that are not a name it stops, and says how to make the admin', async () => {
    const { state, shell } = account({ names: ['', '', '', '', '', 'ops'] })
    await expect(setup(shell)).rejects.toThrow('make admin NAME=you')
    expect(state.asked).toBe(5)
    expect(state.ran.at(-1)).toBe('make --no-print-directory secrets')
  })

  test('with no terminal to confirm on, it does nothing', async () => {
    const { state, shell } = account({ noTerminal: true })
    await expect(setup(shell)).rejects.toThrow('no terminal to confirm the account on')
    expect(state.ran).toEqual([])
    expect(state.files[LOCAL]).toBeUndefined()
  })

  test('a login that reaches several accounts has to say which one', async () => {
    const accounts = [
      { name: 'Personal', id: 'a'.repeat(32) },
      { name: 'Work', id: 'b'.repeat(32) },
    ]
    const unsaid = account({ accounts })
    await expect(setup(unsaid.shell)).rejects.toThrow(`CLOUDFLARE_ACCOUNT_ID=<id> make setup`)
    expect(unsaid.state.ran).toEqual([])
    expect(unsaid.state.confirmations).toEqual([])

    const said = account({ accounts, accountId: 'b'.repeat(32) })
    await setup(said.shell)
    expect(said.state.confirmations).toEqual([`Logged in as someone@example.com. Set up httpdog-house in "Work"? (y/n): `])
  })

  test('a key on one Worker only is replaced while nothing was encrypted with it', async () => {
    const { state, shell } = account({ keyOn: [INGEST_DEPLOY] })
    await setup(shell)
    expect(state.ran).toContain('make --no-print-directory secrets FORCE=1')
  })

  test('a key on one Worker only is left alone once signing keys are stored', async () => {
    const { state, shell } = account({ keyOn: [INGEST_DEPLOY], signingKeys: 2, admins: 1 })
    await expect(setup(shell)).rejects.toThrow('make secrets FORCE=1')
    expect(state.ran.some((line) => line.includes('secrets'))).toBe(false)
  })
})
