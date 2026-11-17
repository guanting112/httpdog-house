# Deploying httpdog-house

English | [繁體中文](deploying.zh-TW.md) · back to the [README](../README.md)

It was built for Cloudflare from the start: two Workers and one D1 database, in your account. Everything is built on your machine and uploaded with wrangler; Cloudflare builds nothing and does not read the Git repository.

## Before the first time: two hostnames

A deployment is served from two hostnames of your own, and from nowhere else. Nothing is set up without them: `make setup` and every deploy stop when they are missing, and the `workers.dev` address of each Worker is switched off.

```bash
cp deploy.local.env.example deploy.local.env
```

```
UI_DOMAIN=alerts.example.com       # where you sign in
INGEST_DOMAIN=hook.example.com     # where httpdog POSTs: https://hook.example.com/alerts
```

- **Each is a name under a domain that is in the same Cloudflare account**, and the two are different.
- **Neither has a DNS record yet.** Each becomes a Custom Domain of its Worker: Cloudflare makes the DNS record and the certificate when the Worker is uploaded, so there is nothing to add by hand. A new hostname can take a minute or two to answer.
- **A hostname is not a secret.** The certificate made for it is logged in public, as certificates are, so anyone can come across the name. One that does not say what it is for gives less away. What protects the UI is its login; to keep strangers from reaching even the sign-in page, put Cloudflare Access in front of `UI_DOMAIN`. The receiver has to stay open to your hosts.
- **Changing a hostname later** is the same two lines and `make deploy`. Hosts then need the new address in `HTTPDOG_WEBHOOK_URL`, and alerts sent to the old one are lost.

`make setup` in a checkout that has no `deploy.local.env` writes the file for you, says the above, and stops.

## The first time: `make setup`

| Step | What happens |
|---|---|
| Before anything | Reads the two hostnames from `deploy.local.env`. Without both, it stops here: nobody is asked anything and nothing is created |
| 1. Cloudflare account | If this machine is not logged in, `wrangler login` opens your browser. Then it says who is logged in, which account that is and which hostnames, and asks. Anything but a yes stops it before anything is created. A login that reaches several accounts has to say which: `CLOUDFLARE_ACCOUNT_ID=<id> make setup` |
| 2. Database | Creates the D1 database `httpdog-house` and notes its id in `deploy.local.env`. A database of that name that the account already has is used as it is |
| 3. Tables | Applies `migrations/`. wrangler asks before it does |
| 4. Receiver | Uploads the ingest Worker at `INGEST_DOMAIN`. Cloudflare makes the hostname's DNS record and certificate |
| 5. UI | Builds and uploads the UI Worker at `UI_DOMAIN`, the same way |
| 6. Key | Generates `SECRETS_KEY` and sets it on both Workers. It encrypts the signing secrets in the database, it is stored nowhere else, and nobody needs to know it |
| 7. First admin | Asks for a username, then twice for a password. Skipped when there is an admin already |

It is safe to run again. Each step looks at what is there and does only what is missing, so after a failure it carries on from where it stopped, and on a finished deployment it only uploads the two Workers again.

## Every time after: `make deploy`

`make deploy` runs the checks, updates the tables and uploads both Workers. `make deploy-ingest` and `make deploy-ui` upload one each.

## What is yours: `deploy.local.env`

The one place for what differs from one deployment to the next:

| Value | Meaning |
|---|---|
| `UI_DOMAIN`, `INGEST_DOMAIN` | **Required, and yours to fill in.** The two hostnames, see above. The address httpdog is given follows from the second: `https://<INGEST_DOMAIN>/alerts` |
| `DATABASE_ID` | The id of the D1 database. Filled in by `make setup` |
| `NAME_SUFFIX` | Only for another deployment in the same account, see below |
| `RETENTION_DAYS`, `MAX_SKEW_SECS` | Settings of the receiver, see below |

Git ignores the file. The two `wrangler.jsonc` files are committed and keep example values; the deploy targets put your values into generated configs (`wrangler.deploy.json`, `ingest/wrangler.deploy.json` and `.output/server/wrangler.json`), which Git ignores too, and `make check-config` stops a deploy when a real id, address or route has been written into a committed config. So a public fork carries nobody's deployment, and you can deploy from the checkout you push from. Secrets were never in a committed file: `SECRETS_KEY` is a Cloudflare secret, and locally it is in `.dev.vars`.

A file from before the hostnames were required may hold an `INGEST_URL` line. It is no longer read, and a deploy says so; the line can go.

## More than one deployment in an account

Each deployment has a file and names of its own:

```bash
cp deploy.local.env.example deploy.team-a.env    # then set NAME_SUFFIX=team-a and two hostnames of its own in it
make setup  DEPLOY_ENV=deploy.team-a.env
make deploy DEPLOY_ENV=deploy.team-a.env         # later, to update it
```

The Workers are then `httpdog-house-ui-team-a` and `httpdog-house-ingest-team-a`, the database is `httpdog-house-team-a`, and the sign-in rate limiter gets a number of its own. Nothing is shared between deployments: each has its own hostnames, `SECRETS_KEY`, accounts, keys and alerts. Every command that reaches Cloudflare first says which file it read and which Workers it is about to act on. Without `DEPLOY_ENV` the file is `deploy.local.env`, and with no `NAME_SUFFIX` the names are the plain ones. Set the suffix before the first `make setup` and leave it: a new suffix is a new deployment. Files named `deploy.*.env` are ignored by Git.

## Settings of the receiver

Two more values of `deploy.local.env`. Left empty, the default applies.

| Value | Default | Meaning |
|---|---|---|
| `RETENTION_DAYS` | `365` | How many days an alert is kept. Older ones are deleted once a day. `0` keeps alerts forever |
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
