# httpdog-house

English | [繁體中文](README.zh-TW.md)

The house your [httpdog](https://github.com/guanting112/httpdog)s report back to: every alert from every host, verified, stored and searchable, behind a login. It runs on your own Cloudflare account, and one command puts it there.

```
httpdog (web-01) ──┐
httpdog (web-02) ──┼── POST /alerts ──▶  ingest Worker ──▶  D1  ◀── UI Worker ◀── your browser
httpdog (db-01)  ──┘   signed            verify, store            pages and /api, behind a login
```

## Why you might want it

- **Nothing to look after.** Two Cloudflare Workers and one D1 database. No server to rent, patch or back up.
- **One command to deploy.** `make setup` logs you in, creates the database, uploads both Workers and makes your account.
- **Yours.** All of it is in your Cloudflare account. The alerts are lines from your access logs, and they go nowhere else.
- **Every alert is checked.** Each one carries an HMAC signature, and what fails the check is refused. The **rejected** page says why, so a wrong secret or a clock that is off shows up in the UI.
- **Hard to lose an alert.** The receiver is a small Worker of its own, apart from the UI. A UI update that goes wrong cannot stop alerts from arriving.
- **Nothing to find.** The hostname alone answers "not found", as does every other address, to a browser that has not been to the one address `make setup` gives you. A scanner that comes across the hostname finds no sign-in page, no title and no file.
- **Made for reading.** New alerts appear as they arrive, with filters and a search through the whole request. Dark and light, English and 繁體中文, desktop and phone.

## Deploy it

You need:

- a [Cloudflare](https://dash.cloudflare.com/sign-up) account with a domain of yours on it,
- two hostnames under that domain that are not in use yet: one to sign in at, one for httpdog to send to,
- [Bun](https://bun.sh), and `make` (macOS and Linux have it; on Windows, use WSL).

```bash
git clone https://github.com/guanting112/httpdog-house.git
cd httpdog-house
cp deploy.local.env.example deploy.local.env
```

Put the two hostnames in `deploy.local.env`:

```
UI_DOMAIN=alerts.example.com
INGEST_DOMAIN=hook.example.com
```

Then:

```bash
make setup
```

**Without the two hostnames, `make setup` sets nothing up**: it stops and says what is missing. A deployment is always served from hostnames of your own, never from `workers.dev`. There are no DNS records or certificates to add: Cloudflare makes them when the Workers are uploaded.

`make setup` is the whole first deployment:

1. logs in to Cloudflare if you are not logged in (your browser opens), shows which account it is about to use, and goes on only when you say yes,
2. creates the database and its tables,
3. uploads the receiver and the UI, each at its hostname,
4. gives both the key that encrypts stored secrets, which is kept nowhere else,
5. asks for a username and a password, and makes that account the first admin.

It ends with the two addresses: `https://<UI_DOMAIN>/<entry path>` to sign in at, and `https://<INGEST_DOMAIN>/alerts` for your httpdogs. **Keep the first one: it is the only address that lets a browser in.** The hostname alone answers "not found"; once a browser has been to the sign-in address it is remembered. `make entry` shows the address again. A new hostname can take a minute or two to answer. If a step fails, sort out what it says and run `make setup` again: it carries on from where it stopped.

Later, `git pull && make deploy` brings your deployment up to date.

The paid Workers plan is the safe choice: on the free plan, signing in may need more CPU time than a request gets, and that has not been tested. Choosing the hostnames, several deployments in one account, the settings and the limits are in [docs/deploying.md](docs/deploying.md).

## Connect an httpdog

Sign in, open **keys**, and make a key that lists the names of your instances. Its "set up a host" shows the lines below with your values filled in.

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

## Day to day

- **Keys.** A key is one secret plus the instance names allowed to use it; `web-*` covers `web-01` and `web-02`. To change a secret without losing alerts, add a second key, move the hosts to it, then delete the old one.
- **Rejected.** What the receiver turned away is listed with the reason.
- **People.** An admin manages keys and users; a viewer reads. Accounts are made on the **users** page.
- **The sign-in address.** `make entry` shows it. A new browser, or a new person, has to open it once before the hostname answers them. To change it, set another `ENTRY_PATH` in `deploy.local.env` and run `make deploy-ui`: every browser then has to go to the new address.
- **Locked out.** `make admin NAME=you` gives an account a new password.
- **How long alerts are kept.** 365 days. To change it, set `RETENTION_DAYS` in `deploy.local.env` and run `make deploy-ingest`; `0` keeps them forever.
- **Logs.** `make tail-ingest` and `make tail-ui` follow the two Workers live.

## More

| Document | What is in it |
|---|---|
| [docs/deploying.md](docs/deploying.md) | What `make setup` does, your own hostnames, several deployments, settings, Cloudflare's limits |
| [docs/how-it-works.md](docs/how-it-works.md) | Why two Workers, signing keys in detail, what the receiver answers, what is stored, security |
| [docs/development.md](docs/development.md) | Running it on your machine, where things are, what has been checked |

## Security and license

Found a vulnerability? Please report it privately, as [SECURITY.md](SECURITY.md) describes, not in a public issue.

Released under the [MIT License](LICENSE).
