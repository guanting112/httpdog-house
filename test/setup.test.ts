import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { INGEST_DEPLOY, LOCAL, LOCAL_EXAMPLE, parseEnv, UI_DEPLOY } from '../scripts/deploy-config'
import { isEntryPath } from '../shared/door'
import { namedAfter, PATHS_NOTE, readCount, readDatabases, setEnvValue, setup, SetupError, type Shell } from '../scripts/setup'

const ID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'
const CREATED = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const EXAMPLE = readFileSync(resolve(import.meta.dir, '..', LOCAL_EXAMPLE), 'utf8')
/** The file as a person leaves it before the first `make setup`: the example, with the two hostnames filled in */
const READY = setEnvValue(setEnvValue(EXAMPLE, 'UI_DOMAIN', 'alerts.example.com'), 'INGEST_DOMAIN', 'hook.example.com')

/** A Cloudflare account and a terminal that exist only here. `ran` is every command that was shown on the terminal */
function account(start: {
  /** The deployment's file. READY unless a test says otherwise; null for a checkout that has none yet */
  file?: string | null
  /** What the deployment's file is called. LOCAL unless a test says otherwise */
  name?: string
  /** Other files in the checkout, such as another deployment's */
  others?: Record<string, string>
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
  const file = start.file === undefined ? READY : start.file
  const state = {
    files: { [LOCAL_EXAMPLE]: EXAMPLE, ...start.others, ...(file === null ? {} : { [start.name ?? LOCAL]: file }) } as Record<string, string>,
    loggedIn: start.loggedIn ?? true,
    databases: [...(start.databases ?? [])],
    keyOn: start.keyOn ?? [],
    admins: start.admins ?? 0,
    ran: [] as string[],
    /** Commands run without being shown: the looking, as against the doing */
    looked: [] as string[],
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
      if (start.failing && line.includes(start.failing)) return { code: 1 }
      if (line === 'bunx wrangler login') state.loggedIn = true
      // a new database gets ID, or another id where the account has one with ID already
      if (line.startsWith('bunx wrangler d1 create ')) state.databases.push({ name: command[4]!, uuid: state.databases.some(({ uuid }) => uuid === ID) ? CREATED : ID })
      if (line.startsWith('make --no-print-directory secrets')) state.keyOn = [INGEST_DEPLOY, UI_DEPLOY]
      if (line.startsWith('bun scripts/create-admin.ts ')) state.admins++
      return { code: 0 }
    },
    async capture(command) {
      const line = command.join(' ')
      state.looked.push(line)
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
    files: () => Object.keys(state.files),
  }
  return { state, shell }
}

describe('what setup reads', () => {
  test('a value is set in place, or added when the file has no line for it', () => {
    expect(setEnvValue('# a comment\nDATABASE_ID=\nUI_DOMAIN=\n', 'DATABASE_ID', ID)).toBe(`# a comment\nDATABASE_ID=${ID}\nUI_DOMAIN=\n`)
    expect(setEnvValue('UI_DOMAIN=a.example.com', 'DATABASE_ID', ID)).toBe(`UI_DOMAIN=a.example.com\nDATABASE_ID=${ID}\n`)
    expect(parseEnv(setEnvValue(EXAMPLE, 'DATABASE_ID', ID)).DATABASE_ID).toBe(ID)
  })

  // Found by test/fuzz.test.ts
  test('a value is written as it is, over the whole line, on every line for the key', () => {
    expect(setEnvValue('UI_DOMAIN=old\n', 'UI_DOMAIN', "a$&b$'")).toBe("UI_DOMAIN=a$&b$'\n")
    expect(setEnvValue('UI_DOMAIN=old\rstill the same line\nINGEST_DOMAIN=\n', 'UI_DOMAIN', 'new')).toBe('UI_DOMAIN=new\nINGEST_DOMAIN=\n')
    expect(parseEnv(setEnvValue('DATABASE_ID=\n# again, by hand\nDATABASE_ID=\n', 'DATABASE_ID', ID)).DATABASE_ID).toBe(ID)
  })

  test('the databases of the account are read from the list wrangler prints', () => {
    const list = JSON.stringify([
      { uuid: 'other', name: 'httpdog-house-team-a', version: 'production' },
      { uuid: ID, name: 'httpdog-house' },
      { name: 'no id' },
    ])
    expect(readDatabases(list)).toEqual([
      { uuid: 'other', name: 'httpdog-house-team-a' },
      { uuid: ID, name: 'httpdog-house' },
    ])
    expect(readDatabases('[]')).toEqual([])
    for (const not of ['not json', '{}', '[null]']) expect(readDatabases(not)).toBeUndefined()
  })

  test('a count is read from the one row', () => {
    expect(readCount('[{"results":[{"n":3}],"success":true}]')).toBe(3)
    expect(readCount('[{"results":[],"success":true}]')).toBeUndefined()
    expect(readCount('Error')).toBeUndefined()
  })
})

describe('make setup, before it starts', () => {
  test('with no file yet, it writes the file, says what to put in it, and does nothing else', async () => {
    const { state, shell } = account({ file: null })
    const stopped = await setup(shell).catch((error: Error) => error)
    expect(stopped).toBeInstanceOf(SetupError)
    expect((stopped as Error).message).toContain('UI_DOMAIN=')
    expect((stopped as Error).message).toContain('INGEST_DOMAIN=')
    expect((stopped as Error).message).toContain('`make setup` again')
    // and while the file is open: what the two paths in it are, each with the address it makes
    expect((stopped as Error).message).toContain(PATHS_NOTE)
    expect(PATHS_NOTE).toContain('https://<UI_DOMAIN>/<ENTRY_PATH>')
    expect(PATHS_NOTE).toContain('https://<INGEST_DOMAIN>/<INGEST_PATH>/alerts')
    // the file is the example, ready to be filled in
    expect(state.files[LOCAL]).toBe(EXAMPLE)
    // nobody was asked anything, and Cloudflare was not even looked at
    expect([state.ran, state.looked, state.confirmations]).toEqual([[], [], []])
  })

  test('without both hostnames in the file, nothing is set up: not on workers.dev, not at all', async () => {
    for (const file of [EXAMPLE, setEnvValue(EXAMPLE, 'UI_DOMAIN', 'alerts.example.com'), setEnvValue(EXAMPLE, 'INGEST_DOMAIN', 'hook.example.com')]) {
      const { state, shell } = account({ file })
      const stopped = await setup(shell).catch((error: Error) => error)
      expect((stopped as Error).message).toContain('Two hostnames of your own are needed first')
      expect((stopped as Error).message).toContain(PATHS_NOTE)
      expect([state.ran, state.looked, state.confirmations]).toEqual([[], [], []])
      expect(state.files[LOCAL]).toBe(file)
    }
  })

  test('a hostname that is not one stops it the same way, and says which', async () => {
    const { state, shell } = account({ file: setEnvValue(READY, 'UI_DOMAIN', 'https://alerts.example.com') })
    const stopped = await setup(shell).catch((error: Error) => error)
    expect((stopped as Error).message).toContain('UI_DOMAIN')
    // a mistyped hostname is one thing to fix; the note about the two paths is not repeated here
    expect((stopped as Error).message).not.toContain(PATHS_NOTE)
    expect([state.ran, state.looked]).toEqual([[], []])
  })
})

describe('make setup', () => {
  test('on a new account it does everything, in order, and notes the database in the file', async () => {
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
    expect(file).toMatchObject({ DATABASE_ID: ID, UI_DOMAIN: 'alerts.example.com', INGEST_DOMAIN: 'hook.example.com' })
    // an entry path was made, and the address to sign in at ends in it: the hostname alone lets nobody in
    expect(isEntryPath(file.ENTRY_PATH)).toBe(true)
    // and a path for the receiver, another one: knowing where to send alerts does not let anyone in
    expect(isEntryPath(file.INGEST_PATH)).toBe(true)
    expect(file.INGEST_PATH).not.toBe(file.ENTRY_PATH)
    expect(result).toEqual({ ui: `https://alerts.example.com/${file.ENTRY_PATH}`, receiver: `https://hook.example.com/${file.INGEST_PATH}/alerts` })
    // a name the UI would refuse is asked for again
    expect(state.asked).toBe(2)
  })

  test('run again, it only brings the deployment up to date', async () => {
    const file = setEnvValue(setEnvValue(setEnvValue(READY, 'DATABASE_ID', ID), 'ENTRY_PATH', 'the-one-already-in-use'), 'INGEST_PATH', 'the-one-hosts-send-to')
    const { state, shell } = account({ file, databases: [{ name: 'httpdog-house', uuid: ID }], keyOn: [INGEST_DEPLOY, UI_DEPLOY], admins: 1 })
    const result = await setup(shell)
    // the addresses people and hosts already use are kept
    expect(result).toEqual({ ui: 'https://alerts.example.com/the-one-already-in-use', receiver: 'https://hook.example.com/the-one-hosts-send-to/alerts' })

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


  test('an entry path that could not be one piece of an address stops it before anything is uploaded', async () => {
    const { state, shell } = account({ file: setEnvValue(READY, 'ENTRY_PATH', 'not/one piece') })
    await expect(setup(shell)).rejects.toThrow('ENTRY_PATH')
    expect(state.ran).toEqual([])
  })

  test('a step that fails stops there, and what was done is kept for the next run', async () => {
    const { state, shell } = account({ failing: 'deploy-ingest' })
    await expect(setup(shell)).rejects.toBeInstanceOf(SetupError)
    expect(state.ran.at(-1)).toBe('make --no-print-directory deploy-ingest')
    expect(parseEnv(state.files[LOCAL]!).DATABASE_ID).toBe(ID)
  })

  test('it says who is logged in, which account, and which Workers and database at which hostnames, and waits for a yes', async () => {
    const { state, shell } = account({})
    await setup(shell)
    expect(state.confirmations).toEqual([`Logged in as someone@example.com. Set up httpdog-house in "Someone's Account"? (y/n): `])
    const before = state.said.slice(0, state.said.indexOf('noted a new entry path in deploy.local.env: the UI will answer "not found" everywhere but there'))
    expect(before).toContain('  httpdog-house-ui      the UI, at alerts.example.com')
    expect(before).toContain('  httpdog-house-ingest  the receiver, at hook.example.com')
    expect(before).toContain('  httpdog-house         the database, to be created')
  })

  test('a database the account already has under the name is said to be used as it is, before the question', async () => {
    const { state, shell } = account({ databases: [{ name: 'httpdog-house', uuid: ID }], confirm: 'n' })
    await expect(setup(shell)).rejects.toThrow('Stopped before changing anything')
    expect(state.said).toContain('  httpdog-house         the database, one the account already has, used as it is')
  })

  test('anything but a yes stops it before a command is run or the file is changed', async () => {
    for (const confirm of ['n', '', 'no', 'maybe']) {
      const { state, shell } = account({ confirm })
      await expect(setup(shell)).rejects.toThrow('Stopped before changing anything')
      expect(state.ran).toEqual([])
      expect(state.files[LOCAL]).toBe(READY)
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
    expect(state.files[LOCAL]).toBe(READY)
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

describe('make setup for another deployment in the same account', () => {
  const TEAM = 'deploy.team-a.env'
  /** The first deployment's file, as `make setup` left it */
  const FIRST = setEnvValue(setEnvValue(setEnvValue(READY, 'DATABASE_ID', ID), 'ENTRY_PATH', 'the-first-ones-entry'), 'INGEST_PATH', 'the-first-ones-path')
  const OTHER_ID = '11111111-2222-3333-4444-555555555555'
  /** The second deployment's file: the example, with two hostnames of its own */
  const SECOND = setEnvValue(setEnvValue(EXAMPLE, 'UI_DOMAIN', 'team-a.example.com'), 'INGEST_DOMAIN', 'hook-a.example.com')
  const first = { others: { 'deploy.local.env': FIRST }, databases: [{ name: 'httpdog-house', uuid: ID }] }

  test("it is named after its file: its own Workers and its own database, never the first one's", async () => {
    const { state, shell } = account({ ...first, name: TEAM, file: SECOND })
    await setup(shell, TEAM)
    expect(state.said).toContain('  httpdog-house-ui-team-a      the UI, at team-a.example.com')
    expect(state.said).toContain('  httpdog-house-ingest-team-a  the receiver, at hook-a.example.com')
    expect(state.said).toContain('  httpdog-house-team-a         the database, to be created')
    expect(state.ran).toContain('bunx wrangler d1 create httpdog-house-team-a --update-config=false')
    expect(parseEnv(state.files[TEAM]!).DATABASE_ID).toBe(CREATED)
    // the first deployment's file is left as it was
    expect(state.files['deploy.local.env']).toBe(FIRST)
  })

  test('its file is written the first time, saying what the names will be', async () => {
    const { state, shell } = account({ ...first, name: TEAM, file: null })
    const stopped = await setup(shell, TEAM).catch((error: Error) => error)
    expect((stopped as Error).message).toContain(namedAfter(TEAM, 'team-a'))
    expect(namedAfter(TEAM, 'team-a')).toContain('httpdog-house-ui-team-a and httpdog-house-ingest-team-a')
    expect(namedAfter(TEAM, 'team-a')).toContain('its database is httpdog-house-team-a')
    expect(state.files[TEAM]).toBe(EXAMPLE)
    expect([state.ran, state.looked]).toEqual([[], []])
  })

  test('a file name that is not a deployment\'s stops it before anything is written', async () => {
    for (const name of ['team-a.env', 'deploy.Team-A.env', 'deploy.team_a.env', 'deploy.-a.env', '.env']) {
      const { state, shell } = account({ name, file: null })
      await expect(setup(shell, name)).rejects.toThrow('Nothing was set up yet')
      expect(state.files[name]).toBeUndefined()
      expect([state.ran, state.looked]).toEqual([[], []])
    }
  })

  test("a file copied from the first deployment's stops it before Cloudflare is looked at", async () => {
    const copied = setEnvValue(setEnvValue(FIRST, 'UI_DOMAIN', 'team-a.example.com'), 'INGEST_DOMAIN', 'hook-a.example.com')
    const { state, shell } = account({ ...first, name: TEAM, file: copied })
    await expect(setup(shell, TEAM)).rejects.toThrow(`${TEAM} and deploy.local.env have the same DATABASE_ID`)
    expect([state.ran, state.looked]).toEqual([[], []])
  })

  test("a hostname of the first deployment's stops it the same way", async () => {
    const { state, shell } = account({ ...first, name: TEAM, file: setEnvValue(SECOND, 'INGEST_DOMAIN', 'Hook.Example.com') })
    await expect(setup(shell, TEAM)).rejects.toThrow(`hook.example.com is in both ${TEAM} and deploy.local.env`)
    expect([state.ran, state.looked]).toEqual([[], []])
  })

  test("the database in the file has to be this deployment's, or nothing is done", async () => {
    // copied on another machine, where the first deployment's file is not there to compare with
    const { state, shell } = account({ name: TEAM, file: setEnvValue(SECOND, 'DATABASE_ID', ID), databases: first.databases })
    await expect(setup(shell, TEAM)).rejects.toThrow(`DATABASE_ID in ${TEAM} is the database httpdog-house, and this deployment's is httpdog-house-team-a`)
    expect([state.ran, state.confirmations]).toEqual([[], []])
  })

  test('a database the account does not have is not used either', async () => {
    const { state, shell } = account({ name: TEAM, file: setEnvValue(SECOND, 'DATABASE_ID', OTHER_ID), databases: first.databases })
    await expect(setup(shell, TEAM)).rejects.toThrow(`DATABASE_ID in ${TEAM} is not a database of "Someone's Account"`)
    expect([state.ran, state.confirmations]).toEqual([[], []])
  })

  test('run again, it finds its own database and only brings it up to date', async () => {
    const file = setEnvValue(setEnvValue(setEnvValue(SECOND, 'DATABASE_ID', OTHER_ID), 'ENTRY_PATH', 'team-a-entry-in-use'), 'INGEST_PATH', 'team-a-path-in-use')
    const databases = [...first.databases, { name: 'httpdog-house-team-a', uuid: OTHER_ID }]
    const { state, shell } = account({ ...first, databases, name: TEAM, file, keyOn: [INGEST_DEPLOY, UI_DEPLOY], admins: 1 })
    await setup(shell, TEAM)
    expect(state.said).toContain(`  httpdog-house-team-a         the database, as in ${TEAM}`)
    expect(state.ran).toEqual(['make --no-print-directory db-migrate', 'make --no-print-directory deploy-ingest', 'make --no-print-directory deploy-ui'])
    expect(state.files[TEAM]).toBe(file)
  })

  test('a NAME_SUFFIX left in an older file has to agree with the file name, since its Workers are named by it', async () => {
    const { state, shell } = account({ file: setEnvValue(READY, 'NAME_SUFFIX', 'team-a') })
    await expect(setup(shell)).rejects.toThrow('rename the file deploy.team-a.env')
    expect([state.ran, state.looked]).toEqual([[], []])

    // one that agrees is no reason to stop
    const agrees = account({ ...first, name: TEAM, file: setEnvValue(SECOND, 'NAME_SUFFIX', 'team-a') })
    await setup(agrees.shell, TEAM)
    expect(agrees.state.ran).toContain('bunx wrangler d1 create httpdog-house-team-a --update-config=false')
  })
})
