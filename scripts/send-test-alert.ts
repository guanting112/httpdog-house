// Sends one alert, signed the way httpdog signs it, to check a receiver without a running httpdog.
//
//   HTTPDOG_WEBHOOK_SECRET=<secret> bun scripts/send-test-alert.ts <url> <instance> [rule]
//
//   HTTPDOG_WEBHOOK_SECRET=... bun scripts/send-test-alert.ts http://localhost:8788/alerts web-01
//
// 204 means the receiver stored it. 401 means it was refused: the "rejected" page of the UI says why.
// The secret is read from the environment so that it does not end up in the shell's history.

import { signAlert, utf8 } from '../shared/crypto'

const [url, instance, rule = 'test-alert'] = process.argv.slice(2)
const secret = process.env.HTTPDOG_WEBHOOK_SECRET

if (!url || !instance || !secret) {
  console.error('usage: HTTPDOG_WEBHOOK_SECRET=<secret> bun scripts/send-test-alert.ts <url> <instance> [rule]')
  process.exit(1)
}

const timestamp = Math.floor(Date.now() / 1000)
const address = `203.0.113.${Math.floor(Math.random() * 250) + 1}`
const message = `${address} tried to access /.env (status 404)`
// The same keys, in every case, as httpdog's webhook body (docs/webhook.md)
const body = JSON.stringify({
  source: 'httpdog',
  instance,
  version: 1,
  kind: 'rule',
  rule,
  timestamp,
  text: `[httpdog] ${rule} | ${message} | remote_addr=${address}`,
  message,
  group_by: 'remote_addr',
  group: address,
  hits: null,
  window_secs: null,
  dropped: null,
  event: {
    remote_addr: address,
    host: 'example.com',
    request_method: 'GET',
    uri: '/.env',
    request_uri: '/.env',
    request_path: '/.env',
    status: 404,
    request_time: 0.001,
    body_bytes_sent: 153,
    http_referer: '',
    http_user_agent: 'curl/8.5.0',
  },
})

const response = await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'x-httpdog-timestamp': String(timestamp),
    'x-httpdog-signature': `sha256=${await signAlert(secret, timestamp, utf8(body))}`,
  },
  body,
})
console.log(`${response.status} ${response.statusText}`.trim(), (await response.text()).trim())
process.exit(response.ok ? 0 : 1)
