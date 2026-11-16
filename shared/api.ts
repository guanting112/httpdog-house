// The shapes that cross a boundary: what httpdog sends, what the ingest Worker records about a
// refusal, and what the UI's API answers with. Types only, apart from the list of reasons.

/** The body of httpdog's webhook, version 1 (httpdog: docs/webhook.md). Every key is always present */
export interface AlertBody {
  source: 'httpdog'
  instance: string
  version: number
  kind: string
  rule: string
  timestamp: number
  text: string
  message: string
  group_by: string | null
  group: string | null
  hits: number | null
  window_secs: number | null
  dropped: number | null
  event: Record<string, unknown> | null
}

/** Why the ingest Worker refused a request */
export const REJECT_REASONS = [
  'too_large', // the body is over the size limit
  'bad_body', // not JSON, not from httpdog, or without a usable instance name
  'no_signature', // a signature header is missing or malformed
  'stale', // the timestamp is too far from this receiver's clock
  'unknown_instance', // no enabled key lists this instance
  'bad_signature', // a key lists the instance, but the signature does not match its secret
  'key_unreadable', // a key could not be decrypted: the two Workers have different SECRETS_KEY values
] as const
export type RejectReason = (typeof REJECT_REASONS)[number]

export type Role = 'admin' | 'viewer'

export interface SessionUser {
  id: number
  username: string
  role: Role
}

/** One line of the alert list */
export interface AlertRow {
  id: number
  receivedAt: number
  firedAt: number
  instance: string
  kind: string
  rule: string
  message: string
  groupBy: string | null
  group: string | null
  hits: number | null
  windowSecs: number | null
  dropped: number | null
  deliveries: number
}

export interface AlertDetail extends AlertRow {
  version: number
  /** Name of the signing key that verified it; null when that key has since been deleted */
  keyName: string | null
  /** The request body exactly as httpdog signed it */
  body: string
}

export interface AlertPage {
  items: AlertRow[]
  /** The newest alert id there was when this was read (0 when there are none). Pass as `after` to get what arrived since */
  head: number
  /** Pass as `before` to get the next older page; null when there is nothing older */
  next: number | null
  /**
   * Set only for a text search that stopped before reaching the oldest alert: one request reads a
   * limited stretch of alerts. `to` is the time of the oldest alert it looked at
   */
  searched: { to: number } | null
}

export interface Overview {
  now: number
  /** Alerts per hour over the last 24 hours, oldest first, narrowed by the instance and rule asked for */
  hours: { hour: number; total: number }[]
  total: number
  /** Busiest first, over the same 24 hours */
  rules: { name: string; total: number }[]
  instances: { name: string; total: number }[]
  /** Every instance and rule that has alerts, for the filters */
  facets: { instances: string[]; rules: string[] }
}

export interface InstanceRow {
  name: string
  /** false for a name a key lists that has not sent anything yet */
  seen: boolean
  firstAt: number | null
  lastAt: number | null
  total: number
  day: number
  rules: number
  /** Names of the enabled keys that accept this instance; empty means its alerts are refused */
  keys: string[]
}

export interface KeyRow {
  id: number
  name: string
  fingerprint: string
  enabled: boolean
  createdAt: number
  createdBy: string | null
  patterns: string[]
  /** When an alert was last verified with this key */
  lastUsedAt: number | null
}

export interface KeyList {
  /** Where httpdog should POST: the ingest Worker's address */
  ingestUrl: string
  keys: KeyRow[]
}

export interface RejectionRow {
  id: number
  at: number
  reason: RejectReason
  instance: string | null
  ip: string | null
  detail: string | null
}

export interface UserRow {
  id: number
  username: string
  role: Role
  disabled: boolean
  createdAt: number
  lastLoginAt: number | null
}

/** The body of an error answer: `code` is what the UI translates */
export interface ApiErrorData {
  code: string
}
