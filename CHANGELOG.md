# Changelog

Notable changes in each version. A version is a tag on `main`, such as `v0.1.0`. Add a line under Unreleased for anything someone who runs a deployment would notice.

## [Unreleased]

## [0.1.0] - 2026-11-18

The first numbered release.

### Added

- **The receiver.** A Worker of its own that takes httpdog's alerts at one address, checks the HMAC-SHA256 signature and the timestamp of each, and stores it in D1. The same alert sent twice is stored once. What fails a check is refused, and the reason is kept for the **rejected** page.
- **The UI.** The alert list with filters, search and live arrival, one page per alert with its whole body, the last 24 hours in numbers, and the instances that have sent anything. In English and Traditional Chinese, dark and light.
- **Signing keys.** Made, renamed, disabled and deleted in the UI, each with the instances it may sign for; a name may hold `*`. Secrets are stored encrypted with a key only the two Workers hold.
- **Accounts.** Admins and viewers, with passwords stored as PBKDF2-HMAC-SHA256 and sign-in limited to 10 attempts a minute per address.
- **`make setup`.** One command for the first deployment: it logs in, asks which Cloudflare account, creates the database and its tables, uploads both Workers, sets their key and makes the first admin. `make deploy` after that.
- **Two hostnames of your own, and nothing to find at either.** The UI answers `not found` to every request from a browser that has not been to its sign-in address, and the receiver answers `not found` everywhere except at its own address.
- **More than one deployment in an account**, each from an env file of its own.
- **Retention.** Alerts are kept 365 days by default; `RETENTION_DAYS` changes it.

[Unreleased]: https://github.com/guanting112/httpdog-house/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/guanting112/httpdog-house/tree/v0.1.0
