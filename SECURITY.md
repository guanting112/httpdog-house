# Security policy

`httpdog-house` takes requests from the internet and shows text that came out of access logs, and that text is chosen by whoever sends requests to your sites: paths, query strings, User-Agent and Referer headers. A flaw in how it checks a request or shows that text could let someone forge an alert, make one read as something it is not, or get into the UI. Please report vulnerabilities privately.

## Supported versions

Only the latest release receives security fixes. A fix lands on `main` and ships as a new release; older releases are not patched. A deployment is brought up to date with `git pull && make deploy`.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting:

https://github.com/guanting112/httpdog-house/security/advisories/new

Do not open a public issue, pull request or discussion for a vulnerability.

Please include:

- the commit your deployment was built from (`git rev-parse --short HEAD`)
- which part it is about: the receiver (the ingest Worker), the UI and its API, or the deploy scripts
- the request or the steps that reproduce the problem, with secrets and anything you do not want to publish removed
- what happened and what you expected instead

## What to expect

- You will get an acknowledgement within 7 days.
- A confirmed vulnerability is fixed on `main`, normally within 30 days. If it needs longer, you will be told why.
- The fix is announced in a GitHub security advisory, crediting you unless you prefer otherwise. Please keep the details private until that advisory is published.

## Scope

The receiver is open to the internet and treats everything it is sent as hostile; the UI treats the text of an alert the same way. So these are vulnerabilities:

- a request that is stored as an alert without a valid signature from an enabled key that lists its instance, as described in [docs/how-it-works.md](docs/how-it-works.md)
- text in an alert that runs as script or markup in the UI, or that is shown as something other than what it is, such as through control characters or marks that reverse the direction of text
- reading or changing anything through the UI's API without a session, or doing what only an admin may do without being one
- a signing secret, a password, a session token or `SECRETS_KEY` that can be read from a response, a log line or a copy of the database
- a request that makes a Worker fail for the requests after it, or that lets a stranger fill the database
- a deploy script that writes a real database id, address or secret into a file that Git tracks

These are ordinary bugs; please open a public issue for them:

- an alert that is shown wrong, or a filter or a search that misses one
- anything that needs the Cloudflare account, `SECRETS_KEY` or a signing secret. Whoever holds those controls the deployment
- alerts sent by a host that holds a valid secret for its instance. The receiver trusts what such a host signs
- alerts that are lost because a Cloudflare plan's limits were reached. Those limits are documented (see [docs/deploying.md](docs/deploying.md))
