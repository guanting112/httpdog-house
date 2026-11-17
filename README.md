# httpdog-house

English | [繁體中文](README.zh-TW.md)

A place to read the alerts your [httpdog](https://github.com/guanting112/httpdog) instances send.

httpdog watches access logs and POSTs an alert to a URL of your choice. This project is that URL, plus a UI behind a login: it receives the alerts of every instance, checks each one's signature, stores them, and lets you search and filter them. It runs entirely on Cloudflare: two Workers and one D1 database.

```
httpdog (web-01) ──┐
httpdog (web-02) ──┼── POST /alerts ──▶  ingest Worker ──▶  D1  ◀── UI Worker ◀── your browser
httpdog (db-01)  ──┘   signed            verify, store            pages and /api, behind a login
```

- [Why two Workers](#why-two-workers)
- [Try it on your machine](#try-it-on-your-machine)
- [Deploying to Cloudflare](#deploying-to-cloudflare)
- [Connecting an httpdog](#connecting-an-httpdog)
- [Signing keys and instances](#signing-keys-and-instances)
- [What the receiver answers](#what-the-receiver-answers)
- [Accounts](#accounts)
- [What is stored, and for how long](#what-is-stored-and-for-how-long)
- [Security notes](#security-notes)
- [Cloudflare limits worth knowing](#cloudflare-limits-worth-knowing)
- [Where things are](#where-things-are)
- [What has been checked](#what-has-been-checked)

## Why two Workers

| | ingest Worker (`ingest/`) | UI Worker (`app/`, `server/`) |
|---|---|---|
| Does | Receives `POST /alerts`, verifies, writes to D1 | Serves the pages and their API; reads D1, manages keys and users |
| Built with | Plain TypeScript, no dependencies, about 5 KB gzipped | Nuxt (the pages are static files; the Worker answers `/api`) |
| Who reaches it | Your httpdog hosts | People who sign in |

They are separate because they fail differently and are trusted differently:

- **An alert that is not accepted is lost.** httpdog tries 3 times within a few seconds, then gives up. The receiver should be the part that almost never changes. A broken UI deploy cannot stop alerts from arriving.
- **The receiver must be open to the internet; the UI need not be.** With its own hostname, the UI can sit behind Cloudflare Access or an IP rule without touching the address your hosts send to.
- **The receiver stays small enough to read in one sitting.** Everything it does is in `ingest/src/receiver.ts`.

Both use the same database and share a little code (`shared/`): the signature check, the encryption of stored secrets and the instance patterns.

## Try it on your machine

Needs [Bun](https://bun.sh). Nothing here touches Cloudflare.

```bash
bun install
make dev-init                    # local secrets and the local database
make admin-local NAME=you        # asks for a password
make dev                         # UI on http://localhost:3000, receiver on http://localhost:8788
```

Sign in, open **keys**, make a key that lists the instance `web-01`, and copy its secret. Then send something:

```bash
# one signed test alert
make test-alert SECRET=<the secret> INSTANCE=web-01

# or 3 real ones from httpdog itself, run in a checkout of httpdog
HTTPDOG_WEBHOOK_URL=http://127.0.0.1:8788/alerts HTTPDOG_WEBHOOK_SECRET=<the secret> \
  httpdog --stdin --config rules.example.yaml < sample.log
```

The alerts page shows them within a few seconds, without a reload. Send one with a wrong secret and it appears under **rejected**, with the reason.

`make` lists every command. `make preview` builds the UI and runs it under wrangler, the way Cloudflare will.

## Deploying to Cloudflare

Everything is built on your machine and uploaded with wrangler. `make login` once per machine.

1. **Create the database.** `make db-create` creates it and writes `deploy.local.env` from its example. Put the `database_id` it prints in that file as `DATABASE_ID`. Leave the two `wrangler.jsonc` files as they are.
2. **Deploy.** `make deploy` runs the checks, creates the tables and uploads both Workers. Each gets a `workers.dev` address; to use your own hostnames, set `UI_DOMAIN` and `INGEST_DOMAIN` in `deploy.local.env`.
3. **Give both Workers the same `SECRETS_KEY`.** `make secrets` generates one and sets it on both. It is the key that encrypts the signing secrets in the database; it is stored nowhere else and nobody needs to know it.
4. **Tell the UI where the receiver is.** Set `INGEST_URL` in `deploy.local.env` to the receiver's address ending in `/alerts`, then `make deploy-ui`. With `INGEST_DOMAIN` set there is nothing to do: the address follows it. The keys page shows this address in the lines to copy to a host.
5. **Create the first admin.** `make admin NAME=you`.

After that, `make deploy` is the whole deploy. `make deploy-ingest` and `make deploy-ui` upload one Worker each.

**What is yours stays out of the repository.** `deploy.local.env` holds the database id, the receiver's address and your hostnames, and Git ignores it. The two `wrangler.jsonc` files are committed and keep their example values; the deploy targets put your values into generated configs (`wrangler.deploy.json`, `ingest/wrangler.deploy.json` and `.output/server/wrangler.json`), which Git ignores too. `make check-config` stops a deploy when a real id, address or route has been written into a committed config. So a public clone carries nobody's deployment, and you can go on deploying from the checkout you push from. Secrets were never in a file that is committed: `SECRETS_KEY` is a Cloudflare secret, and locally it is in `.dev.vars`.

**More than one deployment in an account.** Each deployment has a file and names of its own. Copy `deploy.local.env.example` to `deploy.<suffix>.env`, set `NAME_SUFFIX` in it, and name the file on every command:

```bash
cp deploy.local.env.example deploy.team-a.env    # then set NAME_SUFFIX=team-a in it
make db-create DEPLOY_ENV=deploy.team-a.env      # put the id it prints in that file
make deploy    DEPLOY_ENV=deploy.team-a.env
make secrets   DEPLOY_ENV=deploy.team-a.env
make admin     DEPLOY_ENV=deploy.team-a.env NAME=you
```

The Workers are then `httpdog-house-ui-team-a` and `httpdog-house-ingest-team-a`, the database is `httpdog-house-team-a`, and the sign-in rate limiter gets a number of its own. Nothing is shared between deployments: each has its own `SECRETS_KEY`, accounts, keys and alerts. Every command that reaches Cloudflare first says which file it read and which Workers it is about to act on. Without `DEPLOY_ENV` the file is `deploy.local.env`, and with no `NAME_SUFFIX` the names are the plain ones. Files named `deploy.*.env` are ignored by Git.

Settings of the receiver, in `ingest/wrangler.jsonc`:

| Variable | Default | Meaning |
|---|---|---|
| `MAX_SKEW_SECS` | `300` | How far a request's timestamp may be from the receiver's clock |
| `RETENTION_DAYS` | `90` | Alerts older than this are deleted once a day. `0` keeps them forever |

## Connecting an httpdog

On the **keys** page, "set up a host" shows these with your values filled in.

`/etc/httpdog/secrets.env`:

```
HTTPDOG_WEBHOOK_URL=https://<the receiver>/alerts
HTTPDOG_WEBHOOK_SECRET=<the secret of a key that lists this instance>
```

The rule file:

```yaml
instance: web-01          # a name the key accepts

notifiers:
  ops:
    type: webhook
    url_env: HTTPDOG_WEBHOOK_URL
    secret_env: HTTPDOG_WEBHOOK_SECRET
```

Then `sudo systemctl restart httpdog`. A reload does not read `secrets.env` again.

If httpdog logs `webhook attempt N failed` with a 401, open **rejected**: it lists what the receiver turned away and why (wrong secret, a name no key lists, a clock that is off).

## Signing keys and instances

A **key** is one HMAC secret plus the list of instances allowed to use it.

- **How a request is checked.** The receiver reads `instance` from the body, finds every enabled key that lists that name, and accepts the request if its signature matches one of them. Reading the name first gives a forger nothing: it only picks which secret the signature has to match.
- **Names and patterns.** A key lists names exactly as written after `instance:` in the rule files. `*` stands for any run of characters: `web-*` covers `web-01` and `web-02`, and a line with only `*` accepts any name. One secret for a group of hosts, or one per host: both work.
- **An instance no key lists is refused**, even with a valid signature from some other key.
- **Changing a secret without losing alerts.** Add a second key for the same instances, move the hosts to its secret one by one, then delete the old key. While both exist, either secret is accepted.
- **Fingerprint.** Each key shows the first 8 hex digits of SHA-256(secret). The same secret on a host gives the same digits, so "do both sides have the same secret?" can be answered without showing the secret:

  ```bash
  sudo grep '^HTTPDOG_WEBHOOK_SECRET=' /etc/httpdog/secrets.env | cut -d= -f2- | tr -d '\n' | sha256sum | cut -c1-8
  ```
- **Bringing your own secret.** When making a key, "use one I already have" takes the value already on your hosts, so they need no change.
- Changes on the keys page apply to the next request. Nothing is cached.

## What the receiver answers

`POST /alerts` is the only address that takes alerts. The contract is httpdog's [docs/webhook.md](https://github.com/guanting112/httpdog/blob/main/docs/webhook.md).

| Status | When |
|---|---|
| `204` | Verified and stored. Also when the same alert arrives again |
| `400` | The body is not JSON from httpdog, or has no usable `instance` |
| `401` | No signature headers; a timestamp too far from now; no key lists the instance; the signature matches no key |
| `413` | The body is over 256 KiB |
| `500` | Storing failed, or a key could not be decrypted (the Workers have different `SECRETS_KEY` values). httpdog tries again |

The answer never says which check failed; the reason is on the **rejected** page. `GET /health` answers `200 ok` and touches nothing.

## Accounts

- An **admin** manages keys and users and sees the rejected requests. A **viewer** reads alerts and instances.
- `make admin NAME=you` creates an admin, and resets one: the way back in when the only admin forgot their password.
- There is no "first run" page. A page that lets whoever arrives first become admin is a page a stranger can find before you do.
- The last admin who can sign in cannot be demoted, disabled or deleted.
- A new password, or disabling an account, signs it out everywhere.

## What is stored, and for how long

Tables are in `migrations/0001_init.sql`.

- **Alerts** keep the request body exactly as it was signed, plus the fields the list shows and filters by.
- **The same alert sent twice is stored once.** httpdog sends again when the answer to an attempt does not reach it in time. The body is the same, so the second arrival only raises a counter, shown as "sent 2 times".
- **Roll-ups.** The receiver keeps two small tables of counts (per instance and rule, and per hour). The numbers on the alerts and instances pages are read from these, never by counting alerts.
- **Rejected requests** keep the reason, the claimed instance and the address, never the body. Only the newest 500 are kept, and they are recorded at a limited rate (a burst of 12, then one every 10 seconds per running copy of the Worker), so a stranger hammering the receiver cannot fill the database.
- **Clean-up.** Once a day the receiver deletes alerts older than `RETENTION_DAYS`, expired sessions and rejections older than 30 days.
- **Search** looks for text anywhere in the body, ignoring case. One request looks through at most 50,000 alerts, says how far back it got, and "search older" continues from there.

## Security notes

- **Every alert is verified before it is stored**: HMAC-SHA256 over `<timestamp>.<body>`, compared in constant time, and a timestamp within 5 minutes.
- **Signing secrets are encrypted in the database** (AES-256-GCM) with `SECRETS_KEY`, which only the two Workers hold. A copy of the database alone does not give them away. If `SECRETS_KEY` is lost, set a new one (`make secrets FORCE=1`) and make the keys again with "use one I already have".
- **Passwords** are stored as PBKDF2-HMAC-SHA256 with 100,000 iterations, the most the Workers runtime allows, with a minimum length of 10. Sign-in is limited to 10 attempts a minute per address.
- **Sessions** are a random token in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie; the database holds only its SHA-256.
- **The API checks every request itself** (`server/middleware/guard.ts`): a session for everything, an admin for `/api/admin`, and for anything that changes data, that the request came from this site's own pages.
- **Text from access logs is shown as text.** No markup is ever built from it, control characters and direction-reversing marks are shown as escapes, and the pages carry a Content-Security-Policy that allows only this site's own scripts.
- **Worth adding in the Cloudflare dashboard**: Cloudflare Access in front of the UI's hostname, and a rate limiting rule on the receiver's hostname.

## Cloudflare limits worth knowing

Check Cloudflare's own pages for today's numbers; this is what the design leans on.

- **Rows written.** An alert costs roughly 7 rows by D1's count (the row, its index entries and the two roll-ups), and deleting it later costs about the same again. The free plan's daily allowance of rows written is therefore the first limit a busy fleet meets.
- **Rows read.** Lists and counts read a page at a time. The exception is search, which is bounded as described above.
- **CPU time.** Checking a password is deliberately slow. On the free plan a request gets 10 ms of CPU time, and a sign-in needs more than that. Whether Cloudflare tolerates it there has not been tested; if sign-in fails with error 1102, that is the cause, and the paid plan is the fix.
- Both Workers share one database, so both share its allowances.

## Where things are

| Path | What is in it |
|---|---|
| `ingest/src/receiver.ts` | The whole receiver: verify, store, record refusals, daily clean-up |
| `ingest/wrangler.jsonc` | The receiver's Worker: database, settings, the daily timer |
| `server/api/` | The UI's API. `auth/` is sign-in, `admin/` needs an admin |
| `server/middleware/guard.ts` | Who may call what |
| `server/plugins/page-headers.ts` | The Content-Security-Policy of the pages |
| `server/utils/` | Sessions, passwords, input checks |
| `shared/` | Code both Workers use: `crypto.ts`, `instances.ts`, and the types in `api.ts` |
| `app/pages/` | One file per page |
| `app/components/` | `AlertDetail`, `KeySetup`, the header, dialogs, code blocks |
| `app/content/en.ts`, `zh-tw.ts` | Every word the UI shows, one file per language, same shape. Change both together |
| `app/assets/css/main.css` | Colours for both themes, type and the shared classes. The dark look is httpdog's website |
| `migrations/` | The database schema |
| `scripts/` | `create-admin.ts`, `send-test-alert.ts`, and `deploy-config.ts`, which writes the configs to deploy from |
| `deploy.local.env.example` | What a deployment needs from you. Your copy, `deploy.local.env`, is not committed |
| `test/` | Unit tests. `d1.ts` stands in for D1 with an in-memory SQLite that has the real schema |
| `wrangler.jsonc` | The UI's Worker, with example values. `nuxt build` merges it into `.output/server/wrangler.json` |

Notes for whoever edits it:

- **Keep it true to httpdog.** The body, the headers and the signature are httpdog's public interface (`docs/webhook.md`, `src/notify.rs`). `test/shared.test.ts` checks the signature against the same vector httpdog tests itself with.
- **wrangler and the generated config.** After a build, wrangler run without `-c` uses the config Nitro generated. That is right for deploying the UI and wrong for everything else, so the `Makefile` always passes `-c`.
- **Nothing real in a committed config.** A database id, an address or a hostname of a real deployment goes in `deploy.local.env`, never in a `wrangler.jsonc`. A new value of that kind gets a line in `deploy.local.env.example` and is put in place by `scripts/deploy-config.ts`.
- **The request's own address.** On Workers, h3's `getRequestURL()` says `http://` for an HTTPS request. Code that needs the real origin uses `requestOrigin()` in `server/utils/http.ts`.
- **Fonts.** Ubuntu Mono, Latin subset, served from this site. Chinese text falls back to the system font.
- **Dark and light.** Every colour comes from the tokens at the top of `main.css`; `<html data-theme="light">` swaps in the second set. A new colour goes in as a token with a value for each theme, never as a literal in a component. The theme is the one chosen in the browser (header, sign-in page or account page), else the system's; a small inline script in `nuxt.config.ts` sets it before the first paint.
- **Language.** The UI starts in English; switching to Chinese is remembered in the browser.
- **Two READMEs.** `README.zh-TW.md` is this file in Traditional Chinese. Change both together.

## What has been checked

- `make check`: type checks, and 46 unit tests covering the signature (httpdog's own test vector), encryption, passwords, patterns, the receiver against the real schema (accepted, repeated, refused for each reason, and the daily clean-up), and the configs generated from `deploy.local.env`.
- With invented `deploy.*.env` files, one of them with a `NAME_SUFFIX`, `wrangler deploy --dry-run` accepted the generated configs of both Workers.
- On one machine (macOS, wrangler 4.163.0), with both Workers running in wrangler's local runtime: the real `httpdog` binary replaying `sample.log` delivered its 3 signed alerts, and with a wrong secret all 9 attempts were refused and recorded.
- In headless Chrome against the built UI, over HTTP and HTTPS: sign-in, live arrival of a new alert, filters, creating, editing, disabling and deleting a key with the receiver's answer checked after each step, a viewer being kept out of admin pages and admin API calls, changing a password, and the pages in both languages and both themes at desktop and phone widths.
- **Not checked: anything on Cloudflare itself.** Nothing has been deployed, so the real D1, the rate limiter, the daily timer and the CPU limit of the free plan are untested.
