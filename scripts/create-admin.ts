// Creates an admin account, or resets one: the way in when there is no account yet, and the way
// back in when the only admin has forgotten their password.
//
//   bun scripts/create-admin.ts <username> --local     the local database `make dev` uses
//   bun scripts/create-admin.ts <username> --remote    the real D1 database (needs `wrangler login`)
//
// It asks for the password, hashes it here the same way the UI does, and writes the row with
// `wrangler d1 execute`. The UI has no "first run" page on purpose: a page that lets whoever
// arrives first make themselves admin is a page a stranger can find before you do.
// An existing account of that name gets the new password, becomes an admin, is enabled again and
// is signed out everywhere.

import { hashPassword, PASSWORD_MAX, PASSWORD_MIN, USERNAME } from '../server/utils/password'

/** `database_name` in wrangler.jsonc */
const DATABASE = 'httpdog-house'

function stop(message: string): never {
  console.error(message)
  process.exit(1)
}

/** One line from the terminal without showing it; from a pipe, the first line of input */
async function readPassword(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const text = await Bun.stdin.text()
    return text.split('\n')[0]!.replace(/\r$/, '')
  }
  return new Promise((resolve) => {
    let typed = ''
    // Listening and then letting go, rather than `for await`: leaving that loop early closes the
    // terminal's input for good, and the password is asked for twice
    const finish = () => {
      process.stdin.off('data', onData)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdout.write('\n')
    }
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\r' || char === '\n') {
          finish()
          resolve(typed)
          return
        }
        if (char === '\u0003') {
          finish()
          stop('cancelled')
        }
        if (char === '\u007f' || char === '\b') typed = typed.slice(0, -1)
        else typed += char
      }
    }
    process.stdout.write(question)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', onData)
  })
}

const args = process.argv.slice(2)
const where = args.find((arg) => arg === '--local' || arg === '--remote')
const username = (args.find((arg) => !arg.startsWith('--')) ?? '').toLowerCase()

if (!where || !username) stop('usage: bun scripts/create-admin.ts <username> --local | --remote')
// The name goes into a SQL statement below, so this check is also what keeps that statement safe
if (!USERNAME.test(username)) stop('a username is 1 to 32 of a-z, 0-9, dot, dash and underscore, starting with a letter or digit')

const password = await readPassword(`password for ${username}: `)
if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) stop(`a password is ${PASSWORD_MIN} to ${PASSWORD_MAX} characters`)
if (process.stdin.isTTY && (await readPassword('again: ')) !== password) stop('the two do not match')

// The hash is base64 with $ between its parts: nothing in it can end the quoted string
const hash = await hashPassword(password)
const sql = `
  INSERT INTO users (username, password_hash, role, created_at)
  VALUES ('${username}', '${hash}', 'admin', ${Math.floor(Date.now() / 1000)})
  ON CONFLICT (username) DO UPDATE SET password_hash = excluded.password_hash, role = 'admin', disabled = 0;
  DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = '${username}');
`

// -c: after a build, wrangler would otherwise follow .wrangler/deploy to the generated config
const wrangler = Bun.spawn(['bunx', 'wrangler', 'd1', 'execute', DATABASE, where, '-c', 'wrangler.jsonc', '--yes', '--command', sql], {
  stdout: 'pipe',
  stderr: 'inherit',
})
const output = await new Response(wrangler.stdout).text()
if ((await wrangler.exited) !== 0) {
  // wrangler's own output may repeat the statement, and with it the hash: show it only on failure
  console.error(output)
  stop('wrangler could not write the account')
}
console.log(`ok: ${username} is an admin (${where.slice(2)} database)`)
