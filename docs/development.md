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
| `server/middleware/guard.ts` | Who may call what |
| `server/plugins/page-headers.ts` | The Content-Security-Policy of the pages |
| `server/utils/` | Sessions, passwords, input checks |
| `shared/` | Code both Workers use: `crypto.ts`, `instances.ts`, and the types in `api.ts` |
| `app/pages/` | One file per page |
| `app/components/` | `AlertDetail`, `KeySetup`, the header, dialogs, code blocks |
| `app/content/en.ts`, `zh-tw.ts` | Every word the UI shows, one file per language, same shape. Change both together |
| `app/assets/css/main.css` | Colours for both themes, type and the shared classes. The dark look is httpdog's website |
| `migrations/` | The database schema |
| `scripts/` | `setup.ts` (the first deployment), `deploy-config.ts` (writes the configs to deploy from), `create-admin.ts` and `send-test-alert.ts` |
| `deploy.local.env.example` | What differs from one deployment to the next. Your copy, `deploy.local.env`, is not committed |
| `docs/` | Deploying, how it works, and this file, each in English and Traditional Chinese |
| `.github/workflows/` | `check.yml` (`make check` and `make dry-run` on every push and pull request), `fuzz.yml` (more inputs on a push, far more once a week), `codeql.yml` and `scorecard.yml` (both wait until the repository is public) |
| `.github/dependabot.yml` | Weekly pull requests for new versions of the packages and of the actions |
| `SECURITY.md`, `LICENSE` | How to report a vulnerability; the MIT License |
| `test/` | Unit tests, and `fuzz.test.ts`, which tries generated inputs against what takes input from outside. `d1.ts` stands in for D1 with an in-memory SQLite that has the real schema |
| `wrangler.jsonc` | The UI's Worker, with example values. `nuxt build` merges it into `.output/server/wrangler.json` |

Notes for whoever edits it:

- **Keep it true to httpdog.** The body, the headers and the signature are httpdog's public interface (`docs/webhook.md`, `src/notify.rs`). `test/shared.test.ts` checks the signature against the same vector httpdog tests itself with.
- **Updating wrangler.** Its version is pinned, and Dependabot proposes new ones. `scripts/setup.ts` relies on four things it does, read in the source of 4.163.0 and not covered by the tests, which use a stand-in: `d1 list --json` prints a list with `uuid` and `name`; `d1 create --update-config=false` leaves `wrangler.jsonc` alone; a deploy writes a line of type `deploy` with its `targets` to the file named by `WRANGLER_OUTPUT_FILE_PATH`; and `whoami --json` exits with an error when nobody is logged in. Check them again before taking a new version.
- **Workflows.** Actions are pinned to commit SHAs and a workflow asks for no permission it does not use. None of them holds a Cloudflare credential, so none of them deploys.
- **wrangler and the generated config.** After a build, wrangler run without `-c` uses the config Nitro generated. That is right for deploying the UI and wrong for everything else, so the `Makefile` always passes `-c`.
- **Nothing real in a committed config.** A database id, an address or a hostname of a real deployment goes in `deploy.local.env`, never in a `wrangler.jsonc`. A new value of that kind gets a line in `deploy.local.env.example` and is put in place by `scripts/deploy-config.ts`.
- **The request's own address.** On Workers, h3's `getRequestURL()` says `http://` for an HTTPS request. Code that needs the real origin uses `requestOrigin()` in `server/utils/http.ts`.
- **Fonts.** Ubuntu Mono, Latin subset, served from this site. Chinese text falls back to the system font.
- **Dark and light.** Every colour comes from the tokens at the top of `main.css`; `<html data-theme="light">` swaps in the second set. A new colour goes in as a token with a value for each theme, never as a literal in a component. The theme is the one chosen in the browser (header, sign-in page or account page), else the system's; a small inline script in `nuxt.config.ts` sets it before the first paint.
- **Language.** The UI starts in English; switching to Chinese is remembered in the browser.
- **The reader deploys first.** The README is for someone who wants it running: what it is, `make setup`, connecting a host. What explains or extends it goes in `docs/`.
- **Two languages.** The README and every file in `docs/` has a `.zh-TW.md` twin. Change both together.

## What has been checked

- `make check`: type checks, and 86 tests. 69 are unit tests covering the signature (httpdog's own test vector), encryption, passwords, patterns, the receiver against the real schema (accepted, repeated, refused for each reason, and the daily clean-up), the configs generated from `deploy.local.env`, and the steps of `make setup` against an account that exists only in the test.
- With invented `deploy.*.env` files, one of them with a `NAME_SUFFIX`, `wrangler deploy --dry-run` accepted the generated configs of both Workers.
- `make setup` end to end with stand-ins for wrangler and make that touch nothing: a first run, a second run that finds everything in place, and a run with no terminal to ask on. The first run was also driven in a pseudo-terminal, typing the yes, the name and the password, with an Enter pressed during an earlier step: that Enter once came out as the answer to the next question, and is now thrown away.
- Fuzzing: the other 17 tests are properties in `test/fuzz.test.ts`, each tried with 200 generated inputs in `make check` and with 20,000 in `make fuzz`. They cover the receiver (nothing unsigned is stored and nothing is answered with an error; a signed alert is stored once whatever its fields hold; a body changed after signing and an instance no key lists are refused), signatures, the encryption of stored secrets, instance patterns, the text and highlighting of what is shown on a page, and `deploy.local.env`. The first runs found three things, since fixed: U+061C, a mark that reverses text, was shown as it was; a number such as `1e300` in a signed alert was stored as a time; and a value written to `deploy.local.env` could be changed on the way by a `$` in it or a `\r` in the line it replaced.
- On one machine (macOS, wrangler 4.163.0), with both Workers running in wrangler's local runtime: the real `httpdog` binary replaying `sample.log` delivered its 3 signed alerts, and with a wrong secret all 9 attempts were refused and recorded.
- In headless Chrome against the built UI, over HTTP and HTTPS: sign-in, live arrival of a new alert, filters, creating, editing, disabling and deleting a key with the receiver's answer checked after each step, a viewer being kept out of admin pages and admin API calls, changing a password, and the pages in both languages and both themes at desktop and phone widths.
- On GitHub's Linux runners: `check.yml` (`make check` and `make dry-run`) and `fuzz.yml` (5,000 inputs per property) passed on their first run.
- **Not checked: `codeql.yml` and `scorecard.yml`.** They are skipped while the repository is private, so they have not run.
- **Not checked: anything on Cloudflare itself.** Nothing has been deployed, so `make setup` against a real account, the real D1, the rate limiter, the daily timer and the CPU limit of the free plan are untested.
