// A whole first deployment in one command (`make setup`), and safe to run again: every step looks
// at what is already there and does only what is missing.
//
//   1. log in to Cloudflare if this machine is not logged in, then say which account that is and
//      go on only after a yes
//   2. create the D1 database and note its id in deploy.local.env
//   3. create the tables
//   4. upload the receiver, and note its address in deploy.local.env
//   5. build and upload the UI
//   6. give both Workers the same new SECRETS_KEY
//   7. make the first admin
//
// The file it fills in is the one scripts/deploy-config.ts reads; with DEPLOY_ENV=deploy.<suffix>.env
// it sets up another deployment in the same account. After this, `make deploy` is all an update needs.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { USERNAME } from '../server/utils/password'
import { databaseName, INGEST_DEPLOY, LOCAL, LOCAL_EXAMPLE, parseEnv, readSuffix, ROOT, UI_DEPLOY } from './deploy-config'

const WRANGLER = ['bunx', 'wrangler']
const MAKE = ['make', '--no-print-directory']

/** Everything setup does to the outside: the terminal, the commands it runs and the two files it touches */
export interface Shell {
  /** Runs a command on the terminal, so it can ask its own questions. `output` is what wrangler reported about a deploy */
  run(command: string[]): Promise<{ code: number; output: string }>
  /** Runs a command without showing it and returns what it printed */
  capture(command: string[]): Promise<{ code: number; stdout: string; stderr: string }>
  /** CLOUDFLARE_ACCOUNT_ID of the environment: the account wrangler uses when the login reaches several */
  accountId?: string
  /** The answer typed on the terminal, or null when there is no terminal to type on */
  ask(question: string): string | null
  log(line: string): void
  read(path: string): string | null
  write(path: string, text: string): void
}

/** A step that could not be done. The message says what to do about it */
export class SetupError extends Error {}

/** The file's text with KEY set to value: in place where the line exists, added at the end where it does not */
export function setEnvValue(text: string, key: string, value: string): string {
  // A line ends at \n and nowhere else, as parseEnv reads it. Every line for the key is set, since
  // the last one is the one that counts. The replacement is a function so that a $ in a value stays a $
  const line = new RegExp(`^${key}=[^\\n]*$`, 'gm')
  if (text.search(line) >= 0) return text.replace(line, () => `${key}=${value}`)
  return `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${key}=${value}\n`
}

/** The id of the database with this name in what `wrangler d1 list --json` printed */
export function findDatabase(listJson: string, name: string): string | undefined {
  try {
    const databases = JSON.parse(listJson) as { name?: string; uuid?: string }[]
    return databases.find((database) => database.name === name)?.uuid
  } catch {
    return undefined
  }
}

/**
 * The workers.dev address of a deploy. wrangler writes one JSON object per line to the file named
 * by WRANGLER_OUTPUT_FILE_PATH; the one of type "deploy" lists where the Worker can be reached.
 */
export function workersDevUrl(output: string): string | undefined {
  for (const line of output.split('\n')) {
    try {
      const entry = JSON.parse(line) as { type?: string; targets?: unknown }
      if (entry.type !== 'deploy' || !Array.isArray(entry.targets)) continue
      const url = entry.targets.find((target) => typeof target === 'string' && /^https:\/\/[a-z0-9.-]+\.workers\.dev$/.test(target))
      if (url) return url as string
    } catch {
      // not a line of JSON: nothing to read from it
    }
  }
  return undefined
}

/** The number in the one row a `SELECT count(*) AS n` printed through `wrangler d1 execute --json` */
export function readCount(executeJson: string): number | undefined {
  try {
    const n = (JSON.parse(executeJson) as { results?: { n?: unknown }[] }[])[0]?.results?.[0]?.n
    return typeof n === 'number' ? n : undefined
  } catch {
    return undefined
  }
}

export interface Login {
  email: string
  accounts: { name: string; id: string }[]
}

/** Who is logged in and which accounts they can reach, from what `wrangler whoami --json` printed */
export function readLogin(whoamiJson: string): Login | undefined {
  try {
    const who = JSON.parse(whoamiJson) as { loggedIn?: boolean; email?: unknown; accounts?: unknown }
    if (who.loggedIn !== true || !Array.isArray(who.accounts)) return undefined
    const accounts = (who.accounts as { name?: unknown; id?: unknown }[]).flatMap(({ name, id }) => (typeof name === 'string' && typeof id === 'string' ? [{ name, id }] : []))
    return { email: typeof who.email === 'string' ? who.email : 'an API token', accounts }
  } catch {
    return undefined
  }
}

export async function setup(shell: Shell): Promise<{ ui?: string; receiver?: string }> {
  let step = 0
  const say = (title: string) => shell.log(`\n[${++step}/7] ${title}`)
  const must = async (command: string[], failure: string) => {
    const result = await shell.run(command)
    if (result.code !== 0) throw new SetupError(failure)
    return result
  }
  const count = async (sql: string) => {
    const result = await shell.capture([...WRANGLER, 'd1', 'execute', 'DB', '--remote', '-c', INGEST_DEPLOY, '--json', '--command', sql])
    const n = result.code === 0 ? readCount(result.stdout) : undefined
    if (n === undefined) throw new SetupError(`Could not read from the database.\n${result.stderr.trim()}`)
    return n
  }
  const again = 'Nothing is lost: run `make setup` again once that is sorted out, and it carries on from here.'

  // Which account, said out loud and agreed to before anything is created in it. "Already logged
  // in" is not an answer: a machine may be logged in to an account from another day's work
  say('Cloudflare account')
  const whoami = async () => {
    const result = await shell.capture([...WRANGLER, 'whoami', '--json'])
    return result.code === 0 ? readLogin(result.stdout) : undefined
  }
  let login = await whoami()
  if (!login) {
    await must([...WRANGLER, 'login'], 'Logging in to Cloudflare did not finish.')
    login = await whoami()
    if (!login) throw new SetupError('Could not read who is logged in to Cloudflare. `make whoami` shows what wrangler says.')
  }
  // A login that reaches several accounts does not say which one wrangler will use. It takes
  // CLOUDFLARE_ACCOUNT_ID, so that is asked for rather than guessed
  let target = login.accounts[0]
  if (login.accounts.length > 1) {
    target = login.accounts.find(({ id }) => id === shell.accountId)
    if (!target) {
      const list = login.accounts.map(({ name, id }) => `  ${id}  ${name}`).join('\n')
      throw new SetupError(`${login.email} can reach more than one Cloudflare account:\n${list}\nSay which one to use: CLOUDFLARE_ACCOUNT_ID=<id> make setup`)
    }
  }
  if (!target) throw new SetupError(`${login.email} has no Cloudflare account to deploy to.`)
  const answer = shell.ask(`Logged in as ${login.email}. Set up httpdog-house in "${target.name}"? (y/n): `)
  if (answer === null) throw new SetupError('There is no terminal to confirm the account on, so nothing was done. Run `make setup` in a terminal.')
  if (!/^y(es)?$/i.test(answer.trim())) {
    throw new SetupError('Stopped before changing anything. To use another login: `bunx wrangler logout`, then `make setup` again.')
  }

  // The file of this deployment, written only once the account is agreed to. Everything below
  // reads it again after writing to it
  if (shell.read(LOCAL) === null) {
    const example = shell.read(LOCAL_EXAMPLE)
    if (example === null) throw new SetupError(`${LOCAL_EXAMPLE} is missing; is this a complete checkout?`)
    shell.write(LOCAL, example)
    shell.log(`wrote ${LOCAL}: what is yours about this deployment is kept there, and Git ignores it`)
  }
  const values = () => parseEnv(shell.read(LOCAL) ?? '')
  const set = (key: string, value: string) => shell.write(LOCAL, setEnvValue(shell.read(LOCAL) ?? '', key, value))

  say('Database')
  if (values().DATABASE_ID) {
    shell.log(`already in ${LOCAL}`)
  } else {
    const name = databaseName(readSuffix(values()))
    const list = async () => {
      const result = await shell.capture([...WRANGLER, 'd1', 'list', '--json'])
      if (result.code !== 0) throw new SetupError(`Could not list the databases of the account.\n${result.stderr.trim()}`)
      return findDatabase(result.stdout, name)
    }
    let id = await list()
    if (id) {
      shell.log(`using the database ${name} the account already has`)
    } else {
      // --update-config=false: wrangler would otherwise offer to write the id into wrangler.jsonc, which is committed
      await must([...WRANGLER, 'd1', 'create', name, '--update-config=false'], `Could not create the database ${name}. ${again}`)
      id = await list()
    }
    if (!id) throw new SetupError(`The database ${name} was created but is not in the account's list yet. ${again}`)
    set('DATABASE_ID', id)
    shell.log(`noted its id in ${LOCAL}`)
  }

  say('Tables')
  await must([...MAKE, 'db-migrate'], `Could not create the tables. ${again}`)

  say('Receiver')
  const ingest = await must([...MAKE, 'deploy-ingest'], `Could not upload the receiver. ${again}`)
  if (!values().INGEST_URL && !values().INGEST_DOMAIN) {
    const url = workersDevUrl(ingest.output)
    if (url) {
      set('INGEST_URL', `${url}/alerts`)
      shell.log(`noted its address in ${LOCAL}`)
    } else {
      shell.log(`note: could not read the receiver's address. Set INGEST_URL in ${LOCAL} and run \`make deploy-ui\`, or the keys page shows an example address`)
    }
  }

  say('UI')
  const ui = await must([...MAKE, 'deploy-ui'], `Could not build and upload the UI. ${again}`)

  say('The key that encrypts stored secrets')
  const hasKey = async (config: string) => {
    const result = await shell.capture([...WRANGLER, 'secret', 'list', '-c', config])
    if (result.code !== 0) throw new SetupError(`Could not list the secrets of a Worker.\n${result.stderr.trim()}`)
    return result.stdout.includes('SECRETS_KEY')
  }
  const [ingestHas, uiHas] = [await hasKey(INGEST_DEPLOY), await hasKey(UI_DEPLOY)]
  if (ingestHas && uiHas) {
    shell.log('both Workers have one already')
  } else if (!ingestHas && !uiHas) {
    await must([...MAKE, 'secrets'], `Could not set SECRETS_KEY. ${again}`)
  } else {
    // Half done: one Worker has a key nobody can read back, so both get a new one. That is only
    // harmless while nothing has been encrypted with the old one
    if ((await count('SELECT count(*) AS n FROM signing_keys')) > 0) {
      throw new SetupError(
        'Only one of the two Workers has SECRETS_KEY, and signing keys are already stored. A new key makes them unreadable:\n' +
          'run `make secrets FORCE=1`, then make the keys again on the keys page with "use one I already have".',
      )
    }
    await must([...MAKE, 'secrets', 'FORCE=1'], `Could not set SECRETS_KEY. ${again}`)
  }

  say('First admin')
  if ((await count("SELECT count(*) AS n FROM users WHERE role = 'admin'")) > 0) {
    shell.log('there is one already (`make admin NAME=you` gives an account a new password)')
  } else {
    const later = 'Everything else is in place: run `make admin NAME=you` to make the first admin.'
    let name = ''
    while (!USERNAME.test(name)) {
      const answer = shell.ask('Username for the first admin (a-z, 0-9, dot, dash, underscore): ')
      // No terminal to answer on (a script, a pipe): the password could not be asked for either
      if (answer === null) throw new SetupError(`There is no admin yet, and nobody to ask for a name. ${later}`)
      name = answer.trim().toLowerCase()
    }
    await must(['bun', 'scripts/create-admin.ts', name, '--remote'], `The admin was not created. ${later}`)
  }

  const env = values()
  return {
    ui: env.UI_DOMAIN ? `https://${env.UI_DOMAIN}` : workersDevUrl(ui.output),
    receiver: env.INGEST_URL || (env.INGEST_DOMAIN ? `https://${env.INGEST_DOMAIN}/alerts` : undefined),
  }
}

/** The real thing: commands run in the repository, on this terminal */
function terminal(): Shell {
  const outputFile = join(mkdtempSync(join(tmpdir(), 'httpdog-house-')), 'wrangler-output.ndjson')
  return {
    async run(command) {
      rmSync(outputFile, { force: true })
      const child = Bun.spawn(command, {
        cwd: ROOT,
        stdio: ['inherit', 'inherit', 'inherit'],
        env: { ...process.env, WRANGLER_OUTPUT_FILE_PATH: outputFile },
      })
      const code = await child.exited
      return { code, output: existsSync(outputFile) ? readFileSync(outputFile, 'utf8') : '' }
    },
    async capture(command) {
      const child = Bun.spawn(command, { cwd: ROOT, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
      const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
      return { code: await child.exited, stdout, stderr }
    },
    ask: (question) => (process.stdin.isTTY ? prompt(question) : null),
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || undefined,
    log: (line) => console.log(line),
    read: (path) => (existsSync(resolve(ROOT, path)) ? readFileSync(resolve(ROOT, path), 'utf8') : null),
    write: (path, text) => writeFileSync(resolve(ROOT, path), text),
  }
}

if (import.meta.main) {
  try {
    const { ui, receiver } = await setup(terminal())
    console.log('\nDone.')
    console.log(`  Sign in:         ${ui ?? 'the address of the UI Worker, in the output above'}`)
    console.log(`  httpdog POSTs:   ${receiver ?? `set INGEST_URL in ${LOCAL}`}`)
    console.log('  Next: on the keys page, make a key and follow "set up a host".')
    console.log('  Later: `git pull && make deploy` brings a deployment up to date.')
  } catch (error) {
    // A SetupError, or what deploy-config.ts says about a value in the file
    console.error(`\nerror: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
}
