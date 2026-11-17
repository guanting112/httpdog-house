# Deploying httpdog-house

English | [繁體中文](deploying.zh-TW.md) · back to the [README](../README.md)

It was built for Cloudflare from the start: two Workers and one D1 database, in your account. Everything is built on your machine and uploaded with wrangler; Cloudflare builds nothing and does not read the Git repository.

## The first time: `make setup`

| Step | What happens |
|---|---|
| 1. Cloudflare account | If this machine is not logged in, `wrangler login` opens your browser |
| 2. Database | Creates the D1 database `httpdog-house` and notes its id in `deploy.local.env`. A database of that name that the account already has is used as it is |
| 3. Tables | Applies `migrations/`. wrangler asks before it does |
| 4. Receiver | Uploads the ingest Worker and notes its address in `deploy.local.env` |
| 5. UI | Builds and uploads the UI Worker |
| 6. Key | Generates `SECRETS_KEY` and sets it on both Workers. It encrypts the signing secrets in the database, it is stored nowhere else, and nobody needs to know it |
| 7. First admin | Asks for a username, then twice for a password. Skipped when there is an admin already |

It is safe to run again. Each step looks at what is there and does only what is missing, so after a failure it carries on from where it stopped, and on a finished deployment it only uploads the two Workers again.

## Every time after: `make deploy`

`make deploy` runs the checks, updates the tables and uploads both Workers. `make deploy-ingest` and `make deploy-ui` upload one each.

## What is yours: `deploy.local.env`

`make setup` writes this file and fills it in. It is the one place for what differs from one deployment to the next:

| Value | Meaning |
|---|---|
| `DATABASE_ID` | The id of the D1 database. Filled in by `make setup` |
| `INGEST_URL` | Where httpdog should POST, ending in `/alerts`. The keys page shows it. Filled in by `make setup`; follows `INGEST_DOMAIN` when that is set |
| `UI_DOMAIN`, `INGEST_DOMAIN` | Hostnames of your own, see below |
| `NAME_SUFFIX` | Only for another deployment in the same account, see below |
| `RETENTION_DAYS`, `MAX_SKEW_SECS` | Settings of the receiver, see below |

Git ignores the file. The two `wrangler.jsonc` files are committed and keep example values; the deploy targets put your values into generated configs (`wrangler.deploy.json`, `ingest/wrangler.deploy.json` and `.output/server/wrangler.json`), which Git ignores too, and `make check-config` stops a deploy when a real id, address or route has been written into a committed config. So a public fork carries nobody's deployment, and you can deploy from the checkout you push from. Secrets were never in a committed file: `SECRETS_KEY` is a Cloudflare secret, and locally it is in `.dev.vars`.

## Hostnames of your own

Without them, each Worker is served from `<its name>.<your account>.workers.dev`. To use your own, set them in `deploy.local.env` and deploy:

```
UI_DOMAIN=alerts.example.com
INGEST_DOMAIN=hook.example.com
```

```bash
make deploy
```

Each zone must be in the same Cloudflare account. The receiver's address then follows `INGEST_DOMAIN`, so leave `INGEST_URL` empty; hosts that were already sending need the new address in `HTTPDOG_WEBHOOK_URL`. To have the hostnames from the first deploy, copy `deploy.local.env.example` to `deploy.local.env` and set them before `make setup`.

With a hostname of its own, the UI can sit behind Cloudflare Access or an IP rule without touching the address your hosts send to.

## More than one deployment in an account

Each deployment has a file and names of its own:

```bash
cp deploy.local.env.example deploy.team-a.env    # then set NAME_SUFFIX=team-a in it
make setup  DEPLOY_ENV=deploy.team-a.env
make deploy DEPLOY_ENV=deploy.team-a.env         # later, to update it
```

The Workers are then `httpdog-house-ui-team-a` and `httpdog-house-ingest-team-a`, the database is `httpdog-house-team-a`, and the sign-in rate limiter gets a number of its own. Nothing is shared between deployments: each has its own `SECRETS_KEY`, accounts, keys and alerts. Every command that reaches Cloudflare first says which file it read and which Workers it is about to act on. Without `DEPLOY_ENV` the file is `deploy.local.env`, and with no `NAME_SUFFIX` the names are the plain ones. Set the suffix before the first `make setup` and leave it: a new suffix is a new deployment. Files named `deploy.*.env` are ignored by Git.

## Settings of the receiver

Two more values of `deploy.local.env`. Left empty, the default applies.

| Value | Default | Meaning |
|---|---|---|
| `RETENTION_DAYS` | `400` | How many days an alert is kept. Older ones are deleted once a day. `0` keeps alerts forever |
| `MAX_SKEW_SECS` | `300` | How far a request's timestamp may be from the receiver's clock, in seconds. A request outside it is refused |

```
RETENTION_DAYS=30
```

```bash
make deploy-ingest
```

A shorter time takes effect at the next daily run, which deletes what is now too old. Each deployment has its own values. Something that is not a whole number stops the deploy, so that a typing mistake cannot pass for the default.

## One step at a time

`make setup` runs these for you; each also works alone. `make` lists every command.

| Command | Does |
|---|---|
| `make login`, `make whoami` | Log in to Cloudflare; show which account is logged in |
| `make db-create` | Create the database; you put the id it prints in `deploy.local.env` |
| `make db-migrate` | Create or update the tables |
| `make secrets` | Give both Workers the same new `SECRETS_KEY`. Refuses when one is set, because a new key makes the stored signing secrets unreadable |
| `make admin NAME=you` | Create an admin, or give an account a new password |
| `make dry-run` | Bundle both Workers and check both configs without uploading |
| `make tail-ingest`, `make tail-ui` | Follow a Worker's live log |

## Cloudflare limits worth knowing

Check Cloudflare's own pages for today's numbers; this is what the design leans on.

- **Rows written.** An alert costs roughly 7 rows by D1's count (the row, its index entries and the two roll-ups), and deleting it later costs about the same again. The free plan's daily allowance of rows written is therefore the first limit a busy fleet meets.
- **Rows read.** Lists and counts read a page at a time. The exception is search, which is bounded: one request looks through at most 50,000 alerts.
- **CPU time.** Checking a password is deliberately slow. On the free plan a request gets 10 ms of CPU time, and a sign-in needs more than that. Whether Cloudflare tolerates it there has not been tested; if sign-in fails with error 1102, that is the cause, and the paid plan is the fix.
- Both Workers share one database, so both share its allowances.
