-- The one database both Workers use.
--
--   ingest Worker   reads signing_keys / key_instances, writes alerts, the two roll-ups and rejections
--   UI Worker       reads everything, writes users, sessions, signing_keys and key_instances
--
-- Every time is in Unix seconds, as in httpdog's webhook body.

-- ---------------------------------------------------------------- people who can sign in

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,              -- stored in lower case
  password_hash TEXT    NOT NULL,                     -- pbkdf2-sha256$<iterations>$<salt>$<hash>
  role          TEXT    NOT NULL CHECK (role IN ('admin', 'viewer')),
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE sessions (
  id         TEXT    PRIMARY KEY,                     -- SHA-256 of the cookie's token; the token itself is not stored
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX sessions_user ON sessions (user_id);

-- ---------------------------------------------------------------- who may send

-- A signing key is one HMAC secret. Which instances it may sign for is in key_instances.
CREATE TABLE signing_keys (
  -- AUTOINCREMENT so an id is never used twice: alerts keep the id of a key after it is deleted
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  secret_enc  TEXT    NOT NULL,                       -- the secret, encrypted with the Workers' SECRETS_KEY
  fingerprint TEXT    NOT NULL,                       -- first 8 hex digits of SHA-256(secret), to compare with a host
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  created_by  TEXT
);

-- An instance name, or a pattern in which * stands for any run of characters.
-- A request whose body says `instance: X` is checked against every enabled key that has a pattern matching X.
CREATE TABLE key_instances (
  key_id  INTEGER NOT NULL REFERENCES signing_keys (id) ON DELETE CASCADE,
  pattern TEXT    NOT NULL,
  PRIMARY KEY (key_id, pattern)
) WITHOUT ROWID;

-- ---------------------------------------------------------------- what arrived

CREATE TABLE alerts (
  id          INTEGER PRIMARY KEY,                    -- grows with arrival, so "newest first" is "id descending"
  received_at INTEGER NOT NULL,                       -- when the ingest Worker got it
  fired_at    INTEGER NOT NULL,                       -- `timestamp` in the body: when httpdog saw the log line
  instance    TEXT    NOT NULL,
  kind        TEXT    NOT NULL,                       -- rule | overload
  rule        TEXT    NOT NULL,
  message     TEXT    NOT NULL,
  group_by    TEXT,
  group_value TEXT,
  hits        INTEGER,
  window_secs INTEGER,
  dropped     INTEGER,
  version     INTEGER NOT NULL,                       -- `version` in the body
  key_id      INTEGER,                                -- the signing key that verified it
  body        TEXT    NOT NULL,                       -- the request body exactly as it was signed
  -- httpdog sends an alert again when it does not get an answer in time. The same body is stored
  -- once; a repeat only raises `deliveries`
  body_sha256 TEXT    NOT NULL UNIQUE,
  deliveries  INTEGER NOT NULL DEFAULT 1
);

-- An index on one column also ends in the row id, so each of these serves
-- "WHERE column = ? ORDER BY id DESC" without sorting.
CREATE INDEX alerts_received ON alerts (received_at);
CREATE INDEX alerts_instance ON alerts (instance);
CREATE INDEX alerts_rule     ON alerts (rule);

-- Roll-ups, kept by the ingest Worker in the same transaction as the alert. They let the UI show
-- counts and fill its filters without reading the alerts themselves.

-- One row per instance and rule, for as long as the instance keeps its alerts
CREATE TABLE alert_sources (
  instance TEXT    NOT NULL,
  rule     TEXT    NOT NULL,
  first_at INTEGER NOT NULL,
  last_at  INTEGER NOT NULL,
  total    INTEGER NOT NULL,
  key_id   INTEGER,                                   -- the key that verified the latest one
  PRIMARY KEY (instance, rule)
) WITHOUT ROWID;

-- One row per hour, instance and rule; `hour` is received_at / 3600
CREATE TABLE alert_hours (
  hour     INTEGER NOT NULL,
  instance TEXT    NOT NULL,
  rule     TEXT    NOT NULL,
  total    INTEGER NOT NULL,
  PRIMARY KEY (hour, instance, rule)
) WITHOUT ROWID;

-- ---------------------------------------------------------------- what was turned away

-- The latest requests the ingest Worker refused, so a wrong secret or a wrong clock can be seen
-- from the UI. Nothing in a row is verified. The Worker limits how fast it writes here and keeps
-- only the newest rows.
CREATE TABLE rejections (
  id       INTEGER PRIMARY KEY,
  at       INTEGER NOT NULL,
  reason   TEXT    NOT NULL,                          -- see RejectReason in shared/api.ts
  instance TEXT,                                      -- as the body claimed
  ip       TEXT,
  detail   TEXT
);
