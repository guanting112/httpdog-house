// Every word the UI shows, in English. zh-tw.ts has the same shape; change both together.
// Technical names stay as they are in httpdog (instance, rule, secret), in both languages.

import type { RejectReason } from '#shared/api'

export type Locale = 'en' | 'zh-tw'

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

export const en = {
  locale: 'en' as Locale,
  /** The value of <html lang> */
  lang: 'en',
  /** The language the switch in the header changes to */
  other: { locale: 'zh-tw' as Locale, label: '中文' },

  nav: {
    alerts: 'alerts',
    instances: 'instances',
    keys: 'keys',
    rejected: 'rejected',
    users: 'users',
    signOut: 'sign out',
    skip: 'skip to content',
  },

  common: {
    copy: 'copy',
    copied: 'copied',
    cancel: 'cancel',
    save: 'save',
    close: 'close',
    delete: 'delete',
    loading: 'loading...',
    working: 'working...',
    retry: 'try again',
    refresh: 'refresh',
    never: 'never',
    back: 'back to alerts',
  },

  /** The two looks. The switch in the header shows the one it changes to */
  theme: { label: 'appearance', dark: 'dark', light: 'light' },

  /** How long ago, from a number of seconds */
  ago: (seconds: number): string => {
    if (seconds < 10) return 'just now'
    if (seconds < 60) return `${seconds}s ago`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    return `${Math.floor(seconds / 86400)}d ago`
  },

  login: {
    title: 'sign in',
    lead: 'Alerts from your httpdog instances, in one place.',
    username: 'username',
    password: 'password',
    submit: 'sign in',
  },

  alerts: {
    title: 'alerts',
    lead: 'Everything your httpdog instances have sent, newest first.',
    summary: 'last 24 hours',
    total: (n: number) => plural(n, 'alert', 'alerts'),
    bar: (hour: string, n: number) => `${hour}  ${plural(n, 'alert', 'alerts')}`,
    barsLabel: 'Alerts per hour over the last 24 hours',
    busiestRules: 'rules',
    busiestInstances: 'instances',
    live: 'live',
    liveOn: 'new alerts appear as they arrive',
    liveOff: 'paused',
    liveNotNow: 'a time range in the past has nothing new to show',
    instance: 'instance',
    rule: 'rule',
    time: 'time',
    search: 'search',
    searchPlaceholder: 'an address, a path, a user agent...',
    anyInstance: 'every instance',
    anyRule: 'every rule',
    ranges: {
      all: 'all time',
      '1h': 'last hour',
      '24h': 'last 24 hours',
      '7d': 'last 7 days',
      '30d': 'last 30 days',
      custom: 'between...',
    },
    from: 'from',
    to: 'to',
    clear: 'clear filters',
    columns: { time: 'time', instance: 'instance', rule: 'rule', message: 'message' },
    hits: (hits: number, secs: number | null) => (secs === null ? `${hits}x` : `${hits}x in ${secs}s`),
    dropped: (n: number) => `${plural(n, 'line', 'lines')} dropped`,
    sentTimes: (n: number) => `sent ${n} times`,
    older: 'load older',
    end: 'that is all of them',
    searchedTo: (time: string) => `searched back to ${time}`,
    searchOlder: 'search older',
    noneYet: 'No alerts yet.',
    noneYetAdmin: 'Add a signing key, then point an httpdog at this receiver.',
    noneYetAdminLink: 'set up a key',
    noneYetViewer: 'When an httpdog instance sends one, it shows up here.',
    noMatch: 'Nothing matches these filters.',
    open: 'show the details',
  },

  detail: {
    title: (id: number) => `alert #${id}`,
    text: 'as httpdog printed it',
    fields: 'fields',
    event: 'event: the log line that set it off',
    noEvent: 'An overload alert has no log line behind it.',
    body: 'body, exactly as it was signed',
    instance: 'instance',
    rule: 'rule',
    kind: 'kind',
    fired: 'fired',
    received: 'received',
    later: (seconds: number) => (seconds <= 0 ? 'the same second' : `${seconds}s later`),
    group: 'group',
    threshold: 'threshold',
    dropped: 'dropped',
    deliveries: 'deliveries',
    deliveriesNote: 'httpdog sent this more than once, because the answer to an earlier attempt did not reach it in time. It is one alert.',
    verified: 'verified by',
    keyGone: 'a key that has since been deleted',
    version: 'format version',
    versionNote: 'This UI was written for version 1; some fields may be shown wrong. The body below is complete.',
    onlyInstance: 'only this instance',
    onlyRule: 'only this rule',
    searchGroup: 'search for this',
    link: 'copy link',
    permalink: 'open on its own page',
    notFound: 'There is no alert with this number. It may be older than the retention period.',
  },

  instances: {
    title: 'instances',
    lead: 'Each httpdog names itself with `instance:` in its rule file. These are the names that have sent alerts, and the names a key expects.',
    columns: { name: 'instance', status: 'status', keys: 'accepted by', last: 'last alert', day: '24h', total: 'total', rules: 'rules' },
    ok: 'receiving',
    silent: 'no alerts yet',
    refused: 'refused',
    refusedNote: 'No enabled key lists this name, so what it sends now is refused.',
    silentNote: 'A key lists this name, but nothing has arrived from it.',
    empty: 'No instance has sent anything yet.',
    view: 'its alerts',
  },

  keys: {
    title: 'signing keys',
    lead: 'A key is one HMAC secret and the instances allowed to use it. The receiver reads the instance name from an alert, then checks the signature against every enabled key that lists that name.',
    add: 'new key',
    ingest: 'where httpdog sends',
    ingestUnset: 'INGEST_URL is still the example value. Set it in wrangler.jsonc to the address of the ingest Worker and deploy the UI again.',
    none: 'No keys yet. Until there is one, every alert is refused.',
    enabled: 'enabled',
    disabled: 'disabled',
    fingerprint: 'fingerprint',
    fingerprintNote: 'The first 8 hex digits of SHA-256(secret). The same secret on a host gives the same 8 digits.',
    instances: 'instances',
    noInstances: 'no instances: this key accepts nothing yet',
    anyInstance: 'any instance name',
    createdBy: (when: string, by: string | null) => (by ? `created ${when} by ${by}` : `created ${when}`),
    lastUsed: (when: string) => `last used ${when}`,
    neverUsed: 'never used',
    edit: 'edit',
    setupAction: 'set up a host',
    reveal: 'show secret',
    hide: 'hide secret',
    disable: 'disable',
    enable: 'enable',
    remove: 'delete',
    pending: (instance: string) => `${instance} is not on any key. Add it to one with "edit", or make a new key for it.`,

    form: {
      newTitle: 'new key',
      editTitle: (name: string) => `edit ${name}`,
      name: 'name',
      nameHint: 'For you to recognise it: prod-web, staging...',
      instances: 'instances',
      instancesHint: 'One per line, as written after `instance:` in each rule file. * stands for any run of characters: web-* covers web-01 and web-02; a line with only * accepts any name.',
      secret: 'secret',
      generate: 'generate one (recommended)',
      own: 'use one I already have',
      ownHint: '16 to 256 characters, no spaces. The value of HTTPDOG_WEBHOOK_SECRET on the hosts.',
      create: 'create key',
    },

    made: {
      title: (name: string) => `${name} is ready`,
      lead: 'Put this secret on each host that uses the key. You can show it again later from this page.',
      done: 'done',
    },

    setupLead: 'On each host that uses this key:',
    setup: {
      env: '/etc/httpdog/secrets.env',
      rules: 'in the rule file',
      restart: 'then restart, and check',
      secretPlaceholder: '<the secret of this key>',
      instanceComment: 'a name this key accepts',
      restartComment: 'a reload does not read secrets.env again',
      fingerprintComment: (fingerprint: string) => `prints ${fingerprint} when the host has the same secret`,
      testComment: 'sends one signed test alert from any machine with this repository',
    },

    confirmDelete: {
      title: (name: string) => `delete ${name}?`,
      body: 'Alerts signed with this secret are refused from the next request on, unless another key lists the same instances. Alerts already received stay.',
      yes: 'delete key',
    },
    confirmDisable: 'While it is disabled, alerts signed with this secret are refused.',
  },

  rejected: {
    title: 'rejected',
    lead: 'The latest requests the receiver refused. Nothing here was verified: the instance is what the request claimed. Only some refusals are recorded when many arrive at once.',
    columns: { time: 'time', reason: 'reason', instance: 'instance', from: 'from', detail: 'detail' },
    empty: 'Nothing has been refused.',
    times: (n: number) => `${n} times in a row`,
    since: (time: string) => `since ${time}`,
    clear: 'clear the list',
    addToKey: 'add to a key',
    reasons: {
      too_large: {
        name: 'body too large',
        help: 'The body was over the size limit. httpdog never sends one that big, so this was something else.',
      },
      bad_body: {
        name: 'not an httpdog alert',
        help: 'The body was not JSON from httpdog, or had no usable instance name. Usually a scanner, or another tool pointed at this address.',
      },
      no_signature: {
        name: 'no signature',
        help: 'X-Httpdog-Signature or X-Httpdog-Timestamp was missing. httpdog always sends both, so this was not httpdog.',
      },
      stale: {
        name: 'old timestamp',
        help: "The timestamp was too far from this receiver's clock. Check the clock on that host (timedatectl). A captured request sent again later looks the same.",
      },
      unknown_instance: {
        name: 'instance not on any key',
        help: 'No enabled key lists this name. Add it to a key, or check `instance:` in the rule file on that host.',
      },
      bad_signature: {
        name: 'wrong signature',
        help: 'A key lists this instance, but the signature does not match its secret. Compare the fingerprint on the host with the one on the keys page, and restart httpdog after editing secrets.env.',
      },
      key_unreadable: {
        name: 'key could not be read',
        help: 'The receiver could not decrypt a key: the two Workers have different SECRETS_KEY values. Set the same value on both (make secrets), then create the keys again.',
      },
    } satisfies Record<RejectReason, { name: string; help: string }>,
  },

  users: {
    title: 'users',
    lead: 'Who can sign in. An admin manages keys and users; a viewer only reads alerts.',
    add: 'new user',
    columns: { name: 'username', role: 'role', status: 'status', created: 'created', lastLogin: 'last sign-in' },
    you: 'you',
    roles: { admin: 'admin', viewer: 'viewer' },
    active: 'active',
    disabled: 'disabled',
    makeAdmin: 'make admin',
    makeViewer: 'make viewer',
    disable: 'disable',
    enable: 'enable',
    resetPassword: 'new password',
    remove: 'delete',
    form: {
      title: 'new user',
      username: 'username',
      usernameHint: 'a-z, 0-9, dot, dash and underscore.',
      password: 'password',
      passwordHint: 'At least 10 characters. Give it to them in person; they can change it after signing in.',
      role: 'role',
      create: 'create user',
    },
    reset: {
      title: (name: string) => `new password for ${name}`,
      body: 'They are signed out everywhere and sign in again with this password.',
      submit: 'set password',
    },
    confirmDelete: {
      title: (name: string) => `delete ${name}?`,
      body: 'The account is removed and signed out everywhere.',
      yes: 'delete user',
    },
  },

  account: {
    title: 'account',
    signedInAs: (name: string, role: string) => `Signed in as ${name} (${role}).`,
    changePassword: 'change password',
    current: 'current password',
    next: 'new password',
    nextHint: 'At least 10 characters.',
    again: 'new password again',
    mismatch: 'The two new passwords are not the same.',
    submit: 'change password',
    changed: 'Password changed. Other browsers signed in to this account have been signed out.',
    language: 'language',
  },

  /** What to say for each `code` the API can answer with (server: fail()) */
  errors: {
    unauthorized: 'You are not signed in.',
    forbidden: 'That needs an admin.',
    cross_origin: 'The request was refused because it did not come from this site.',
    wrong_login: 'Wrong username or password.',
    rate_limited: 'Too many attempts. Wait a minute and try again.',
    wrong_password: 'The current password is wrong.',
    weak_password: 'A password is 10 to 200 characters.',
    bad_username: 'A username is 1 to 32 of a-z, 0-9, dot, dash and underscore, starting with a letter or digit.',
    bad_name: 'A key name is 1 to 64 characters.',
    bad_patterns: 'An instance name is 1 to 64 characters, with * for any run of characters.',
    bad_secret: 'A secret is 16 to 256 printable ASCII characters, without spaces.',
    bad_input: 'The request was not understood.',
    name_taken: 'That name is already in use.',
    not_found: 'It no longer exists.',
    last_admin: 'This is the last admin who can sign in. Make someone else an admin first.',
    self: 'You cannot take away your own access. Ask another admin.',
    secrets_key: 'SECRETS_KEY is missing or is not the one the keys were stored with. Set it on the UI Worker (make secrets).',
    no_database: 'The database is not connected: check the D1 binding in wrangler.jsonc.',
    network: 'Could not reach the server.',
    unknown: (message: string) => `Something went wrong: ${message}`,
  },

  notFound: {
    title: 'Nothing at this address',
    body: 'The dog had a sniff. There is nothing here.',
    broken: 'Something went wrong',
    brokenBody: 'The page could not be shown.',
    home: 'back to the alerts',
  },
}

export type Content = typeof en
