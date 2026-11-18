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
INGEST_DOMAIN=hook.example.com     # where httpdog POSTs: https://hook.example.com/<a path>/alerts
```

- **Each is a name under a domain that is in the same Cloudflare account**, and the two are different.
- **Neither has a DNS record yet.** Each becomes a Custom Domain of its Worker: Cloudflare makes the DNS record and the certificate when the Worker is uploaded, so there is nothing to add by hand. A new hostname can take a minute or two to answer.
- **A hostname is not a secret.** The certificate made for it is logged in public, as certificates are, and scanners visit every hostname they learn of. So the UI shows a stranger nothing: see [the sign-in address](#the-sign-in-address) below. A name that does not say what it is for gives less away still. The receiver has to stay open to your hosts, so it takes alerts at one address that nobody would guess, and answers "not found" at every other: see [the receiver's address](#the-receivers-address).
- **Changing a hostname later** is the same two lines and `make deploy`. Hosts then need the new address in `HTTPDOG_WEBHOOK_URL`, and alerts sent to the old one are lost.

`make setup` in a checkout that has no `deploy.local.env` writes the file for you, says the above, and stops.

## The first time: `make setup`

| Step | What happens |
|---|---|
| Before anything | Reads the two hostnames from `deploy.local.env`. Without both, it stops here: nobody is asked anything and nothing is created. It says what to put in the file, and what `ENTRY_PATH` in the same file is: the last piece of the address you will sign in at, yours to choose now or left for `make setup` to make |
| 1. Cloudflare account | If this machine is not logged in, `wrangler login` opens your browser. Then it says who is logged in, which account that is and which hostnames, and asks. Anything but a yes stops it before anything is created. A login that reaches several accounts has to say which: `CLOUDFLARE_ACCOUNT_ID=<id> make setup`. After the yes it notes a new `ENTRY_PATH` and a new `INGEST_PATH` in `deploy.local.env`, unless they are there |
| 2. Database | Creates the D1 database `httpdog-house` and notes its id in `deploy.local.env`. A database of that name that the account already has is used as it is |
| 3. Tables | Applies `migrations/`. wrangler asks before it does |
| 4. Receiver | Uploads the ingest Worker at `INGEST_DOMAIN`. Cloudflare makes the hostname's DNS record and certificate |
| 5. UI | Builds and uploads the UI Worker at `UI_DOMAIN`, the same way |
| 6. Key | Generates `SECRETS_KEY` and sets it on both Workers. It encrypts the signing secrets in the database, it is stored nowhere else, and nobody needs to know it |
| 7. First admin | Asks for a username, then twice for a password. Skipped when there is an admin already |

It is safe to run again. Each step looks at what is there and does only what is missing, so after a failure it carries on from where it stopped, and on a finished deployment it only uploads the two Workers again.

## The sign-in address

`make setup` ends with it, and `make entry` shows it again:

```
https://<UI_DOMAIN>/<ENTRY_PATH>
```

It is the one address of the UI that answers a browser it has not seen. Everything else, the hostname alone, `/login`, the API and every file, answers the same `not found` to such a browser: there is no sign-in page to come across, no title, no icon, nothing that says what runs here.

- **Opening the address once is enough.** It leaves a cookie and sends the browser on to the sign-in page. From then on that browser can use the hostname as it is, for 400 days, and opening the address again renews that.
- **Each browser and each person needs it once.** Give a new user the address together with their account.
- **`ENTRY_PATH` is in `deploy.local.env`.** `make setup` makes one of 16 random characters, unless the file already has one of your own (8 to 64 letters, digits, dashes and underscores). No deploy goes on without it.
- **To change it**, set another and run `make deploy-ui`. Every browser is turned away again until it has been to the new address. Sessions are not ended by this; signing in is as before once a browser is through.
- **It is not a password.** It keeps strangers and scanners from seeing what is here; what protects the alerts is still the login behind it. The address ends up in browser histories and in whatever it was sent through, so treat it as something to keep to yourselves, and change it when someone leaves.
- **On a machine there is no door**: `make dev` and `make preview` answer at every address.

## The receiver's address

```
https://<INGEST_DOMAIN>/<INGEST_PATH>/alerts
```

It is what goes in `HTTPDOG_WEBHOOK_URL` on a host, and the keys page shows it with the rest of what a host needs. The receiver takes alerts there and nowhere else: the hostname alone, the plain `/alerts` and every other address answer `not found`, and a request that is not at the address is not read, checked or noted.

- **A stranger cannot send it anything.** Without the path there is no request to refuse, so nothing a stranger does shows up on the **rejected** page or costs a write to the database. What is listed there comes from someone who has the address: a host of yours with a wrong secret, a name no key lists, or a clock that is off.
- **The signature is still what lets an alert in.** The path only decides who can try.
- **`INGEST_PATH` is in `deploy.local.env`.** `make setup` makes one of 16 random characters, unless the file already has one of your own (8 to 64 letters, digits, dashes and underscores). No deploy goes on without it.
- **Leave it as it is once hosts send to it.** Changing it is changing `HTTPDOG_WEBHOOK_URL` on every host, and alerts sent to the old address in the meantime are lost: httpdog tries 3 times and gives up. If it has to change, set the new one, run `make deploy`, then update the hosts straight away.
- **On a machine there is no path**: `make dev` takes alerts at `/alerts`.

## Every time after: `make deploy`

`make deploy` runs the checks, updates the tables and uploads both Workers. `make deploy-ingest` and `make deploy-ui` upload one each.

## What is yours: `deploy.local.env`

The one place for what differs from one deployment to the next:

| Value | Meaning |
|---|---|
| `UI_DOMAIN`, `INGEST_DOMAIN` | **Required, and yours to fill in.** The two hostnames, see above |
| `DATABASE_ID` | The id of the D1 database. Filled in by `make setup` |
| `ENTRY_PATH` | The last piece of the sign-in address, see above. Filled in by `make setup` unless you set one |
| `INGEST_PATH` | The piece of the receiver's address before `/alerts`, see above. Filled in by `make setup` unless you set one |
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
