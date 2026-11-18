# Developing httpdog-house

English | [繁體中文](development.zh-TW.md) · back to the [README](../README.md)

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

## Where things are

| Path | What is in it |
|---|---|
| `ingest/src/receiver.ts` | The whole receiver: verify, store, record refusals, daily clean-up |
| `ingest/wrangler.jsonc` | The receiver's Worker: database, settings, the daily timer |
| `server/api/` | The UI's API. `auth/` is sign-in, `admin/` needs an admin |
| `server/middleware/` | `01.door.ts`: nothing is answered to a browser that has not been to the sign-in address. `guard.ts`: who may call what |
| `server/plugins/page-headers.ts` | The Content-Security-Policy of the pages |
| `server/utils/` | Sessions, passwords, input checks |
| `shared/` | Code both Workers use: `crypto.ts`, `instances.ts`, and the types in `api.ts`. `door.ts` is the UI's alone, kept here because it needs nothing of Nuxt and the scripts use it too |
| `app/pages/` | One file per page |
| `app/components/` | `AlertDetail`, `KeySetup`, the header, the language menu and the theme button, dialogs, code blocks |
| `app/content/en.ts`, `zh-tw.ts` | Every word the UI shows, one file per language, same shape. Change both together. `languages.ts` lists the languages for the menu, each under its own name |
| `app/assets/css/main.css` | Colours for both themes, type and the shared classes. The dark look is httpdog's website |
| `migrations/` | The database schema |
| `scripts/` | `setup.ts` (the first deployment), `deploy-config.ts` (writes the configs to deploy from), `create-admin.ts` and `send-test-alert.ts` |
| `deploy.local.env.example` | What differs from one deployment to the next. Your copy, `deploy.local.env`, is not committed |
| `docs/` | Deploying, how it works, and this file, each in English and Traditional Chinese; `social-preview.png` is the cover at the top of the README |
| `.github/workflows/` | `check.yml` (`make check` and `make dry-run` on every push and pull request), `fuzz.yml` (more inputs on a push, far more once a week), `codeql.yml` (static analysis on every push and pull request, and once a week) and `scorecard.yml` (publishes the OpenSSF Scorecard result on every push to `main`, and once a week) |
| `.github/dependabot.yml` | Weekly pull requests for new versions of the packages and of the actions |
| `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `LICENSE` | How to report a vulnerability; how to report a bug or send a change; what each version changed; the MIT License |
| `test/` | Unit tests, and `fuzz.test.ts`, which tries generated inputs against what takes input from outside. `d1.ts` stands in for D1 with an in-memory SQLite that has the real schema |
| `wrangler.jsonc` | The UI's Worker, with example values. `nuxt build` merges it into `.output/server/wrangler.json` |

Notes for whoever edits it:

- **Keep it true to httpdog.** The body, the headers and the signature are httpdog's public interface (`docs/webhook.md`, `src/notify.rs`). `test/shared.test.ts` checks the signature against the same vector httpdog tests itself with.
- **Updating wrangler.** Its version is pinned, and Dependabot proposes new ones. `scripts/setup.ts` relies on three things it does, read in the source of 4.163.0 and not covered by the tests, which use a stand-in: `d1 list --json` prints a list with `uuid` and `name`; `d1 create --update-config=false` leaves `wrangler.jsonc` alone; and `whoami --json` prints who is logged in and their accounts, and exits with an error when nobody is. Check them again before taking a new version.
- **Workflows.** Actions are pinned to commit SHAs and a workflow asks for no permission it does not use. None of them holds a Cloudflare credential, so none of them deploys.
- **The files are behind the door too.** That takes two things, and `make deploy-ui` refuses to upload without them. `run_worker_first` in `wrangler.jsonc`, or Cloudflare hands out the files of `public/` on its own. And a binding for those files that is not called `ASSETS`: Nitro's Worker entry gives a file to whoever asks as soon as it finds a binding of that name, before any middleware runs, and Nitro writes that name into the config it generates whatever `wrangler.jsonc` says. So `bun run build` renames it to `FILES` afterwards (`scripts/deploy-config.ts built`), and the door hands the files back itself. After updating Nuxt or Nitro, check with `make preview` that a file is not answered without the cookie.
- **wrangler and the generated config.** After a build, wrangler run without `-c` uses the config Nitro generated. That is right for deploying the UI and wrong for everything else, so the `Makefile` always passes `-c`.
- **Nothing real in a committed config.** A database id, an address or a hostname of a real deployment goes in `deploy.local.env`, never in a `wrangler.jsonc`. A new value of that kind gets a line in `deploy.local.env.example` and is put in place by `scripts/deploy-config.ts`.
- **The request's own address.** On Workers, h3's `getRequestURL()` says `http://` for an HTTPS request. Code that needs the real origin uses `requestOrigin()` in `server/utils/http.ts`.
- **Fonts.** Ubuntu Mono, Latin subset, served from this site. Chinese text falls back to the system font.
- **Dark and light.** Every colour comes from the tokens at the top of `main.css`; `<html data-theme="light">` swaps in the second set. A new colour goes in as a token with a value for each theme, never as a literal in a component. The theme is the one chosen in the browser (header, sign-in page or account page), else the system's; a small inline script in `nuxt.config.ts` sets it before the first paint.
- **Language.** The UI starts in English; switching to Chinese is remembered in the browser.
- **The reader deploys first.** The README is for someone who wants it running: what it is, `make setup`, connecting a host. What explains or extends it goes in `docs/`.
- **Two languages.** The README and every file in `docs/` has a `.zh-TW.md` twin. Change both together.

## What has been checked

**By the tests**

- `make check`: the type checks and 110 tests. 89 are unit tests: the signature (httpdog's own test vector), encryption, passwords, patterns, the door, the receiver against the real schema (accepted, repeated, refused for each reason, the daily clean-up), the configs generated from `deploy.local.env`, and the steps of `make setup` against an account that exists only in the test.
- The other 21 are properties in `test/fuzz.test.ts`, each tried with 200 generated inputs in `make check` and 20,000 in `make fuzz`: the receiver (nothing unsigned is stored, nothing is answered with an error, a signed alert is stored once whatever its fields hold), signatures, the encryption of stored secrets, instance patterns, the text shown on a page, and `deploy.local.env`. The first runs found three things, since fixed: U+061C, a mark that reverses text, was shown as it was; a number such as `1e300` in a signed alert was stored as a time; and a `$` or a `\r` could change a value on its way into `deploy.local.env`.
- On GitHub, on every push: `check.yml`, `fuzz.yml` (5,000 inputs per property), `codeql.yml`, which has reported no alert, and `scorecard.yml`.

**On one machine** (macOS, wrangler 4.163.0, both Workers in wrangler's local runtime)

- The real `httpdog` binary replaying `sample.log` delivered its 3 signed alerts; with a wrong secret all 9 attempts were refused and recorded.
- In headless Chrome against the built UI, over HTTP and HTTPS: sign-in, live arrival of an alert, filters, making, editing, disabling and deleting a key with the receiver's answer checked after each step, a viewer kept out of admin pages and admin API calls, changing a password, and the pages in both languages and both themes at desktop and phone widths.
- The door and the receiver's path, with both paths set: the same answers as on Cloudflare below, and also a forged cookie and the cookie of another entry path turned away, files answered with their cache headers and a `304` to a conditional request, and an unsigned `POST` answered `401`.
- `make setup` end to end with stand-ins for wrangler and make, typed into a pseudo-terminal: a first run, a second run that finds everything in place, and a run with no terminal to ask on.
- `wrangler deploy --dry-run` accepted the configs generated from invented `deploy.*.env` files, one of them with a `NAME_SUFFIX`.

**On Cloudflare** (one account, the paid Workers plan)

- `make setup` ran from start to finish, and the deployment is in use: signing in, the pages, signed alerts from httpdog arriving and listed, and a refused request shown under **rejected** with its reason.
- The door, from outside: without the cookie, `/`, `/login`, an API call, `/favicon.svg` and a wrong entry path all got the same `404 not found`, byte for byte. The entry address answered with a redirect to `/login` and an `HttpOnly`, `Secure` cookie; with it, the pages, the API and the files answered.
- The receiver, from outside: `/`, `/alerts`, `/health` and a wrong path answered `404 not found`; at its address `/health` answered `200` and a `GET` `405`.
- The one exception is `/robots.txt`: this zone serves a robots.txt of Cloudflare's own, and a stranger gets that from both hostnames instead of `not found`. See [the sign-in address](deploying.md#the-sign-in-address).
- **Not checked**: the free plan (the CPU time a sign-in needs), the sign-in rate limiter, the daily clean-up, and a second deployment with a `NAME_SUFFIX`.
