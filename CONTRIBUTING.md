# Contributing

Bug reports and pull requests are welcome. Please write them in English.

## Reporting a bug

Open an issue at https://github.com/guanting112/httpdog-house/issues and include:

- the commit your deployment was built from (`git rev-parse --short HEAD`)
- which part it is about: the receiver (the ingest Worker), the UI and its API, or `make setup` and the deploy scripts
- the steps that reproduce the problem
- what happened and what you expected instead

Alerts hold IP addresses, paths and query strings, and a deployment has two hostnames, a sign-in address, a receiver's address and a database id of its own. Remove what you do not want to publish before pasting anything.

A vulnerability in httpdog-house itself is not an ordinary bug. Report it privately as described in [SECURITY.md](SECURITY.md).

## Proposing a change

For a new feature, open an issue first, so we can agree on the scope before you write code. Small fixes can go straight to a pull request.

Scope: httpdog-house receives the alerts httpdog sends, checks their signature, stores them and shows them behind a login. It runs on Cloudflare Workers and D1 and is deployed with one command.

Pull requests go against `main`. CI runs `make check` (the type checks, the unit tests and the fuzz properties), `make dry-run` (a build of the UI and a bundle of both Workers), a longer fuzz run and CodeQL, and a pull request is merged only when they pass. Dependabot's pull requests follow the same rule.

## Tests

Every change in behaviour comes with tests:

- New or changed logic gets unit tests under `test/`. A bug fix gets a test that fails without the fix.
- A function that takes input from outside gets a property in `test/fuzz.test.ts`. When fuzzing finds a problem, the fix also gets a regression test with that input in the matching test file.
- A change to the steps of `make setup` gets a case in `test/setup.test.ts`, and a new value in `deploy.local.env` gets one in `test/deploy-config.test.ts`.

```sh
make check   # type checks, unit tests, 200 inputs per fuzz property
make fuzz    # 20,000 inputs per fuzz property
```

## Rules a change has to keep

[docs/development.md](docs/development.md) lists them with their reasons. The ones that matter most:

- **Nothing real in a committed file.** A database id, a hostname or an address of a real deployment goes in `deploy.local.env`, which Git ignores. Examples use `example.com`.
- **Everything the receiver is sent is hostile, and so is the text of an alert.** Nothing unsigned is stored, and what a page shows never runs as script or markup.
- **Secrets stay out of logs and responses.** That covers signing secrets, passwords, session tokens, `SECRETS_KEY`, the sign-in address and the receiver's address.
- **Workflows pin actions to a commit SHA** and ask for no permission they do not use. None of them holds a Cloudflare credential.
- **Two languages.** `README.md` and every file in `docs/` has a `.zh-TW.md` twin, and `app/content/en.ts` has `zh-tw.ts`. Change both together.

## Style

- `make check` passes without type errors.
- Code comments, program output and commit messages are in English.
- Commit messages start with a short summary in the imperative ("Add a filter for the key"). The body says why the change is needed and what it does differently.
- Add a line to the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md) for anything someone who runs a deployment would notice.

## License

By contributing, you agree that your contribution is released under the [MIT License](LICENSE).
