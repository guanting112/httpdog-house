# How httpdog-house works

English | [繁體中文](how-it-works.zh-TW.md) · back to the [README](../README.md)

httpdog watches access logs and POSTs an alert to a URL of your choice. This project is that URL, plus a UI behind a login: it receives the alerts of every instance, checks each one's signature, stores them, and lets you search and filter them. It runs entirely on Cloudflare: two Workers and one D1 database.

```
httpdog (web-01) ──┐
httpdog (web-02) ──┼── POST /alerts ──▶  ingest Worker ──▶  D1  ◀── UI Worker ◀── your browser
httpdog (db-01)  ──┘   signed            verify, store            pages and /api, behind a login
```

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
