-- Independent browser authentication. No GitHub API tokens are persisted.
CREATE TABLE browser_oauth_states (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('login','registration')),
  verifier_ciphertext TEXT,
  return_path TEXT NOT NULL DEFAULT '/',
  expires_at INTEGER NOT NULL
);
CREATE INDEX browser_oauth_expiry ON browser_oauth_states(expires_at);
CREATE TABLE browser_auth_settings (
  id TEXT PRIMARY KEY CHECK(id = 'github'),
  ciphertext TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE browser_account_security (
  account TEXT PRIMARY KEY,
  github_id TEXT NOT NULL UNIQUE,
  login TEXT NOT NULL,
  totp_ciphertext TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  version INTEGER NOT NULL DEFAULT 0,
  last_step INTEGER NOT NULL DEFAULT -1,
  change_id TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE browser_sessions (
  id TEXT PRIMARY KEY,
  cookie_hash TEXT NOT NULL UNIQUE,
  account TEXT NOT NULL REFERENCES browser_account_security(account),
  stage TEXT NOT NULL CHECK(stage IN ('mfa','ready')),
  auth_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  pending_totp TEXT,
  pending_expires_at INTEGER
);
CREATE INDEX browser_sessions_account ON browser_sessions(account);
CREATE TABLE browser_access_tokens (
  hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES browser_sessions(id) ON DELETE CASCADE,
  auth_version INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX browser_access_expiry ON browser_access_tokens(expires_at);
CREATE TABLE browser_recovery_codes (
  account TEXT NOT NULL REFERENCES browser_account_security(account),
  hash TEXT NOT NULL,
  PRIMARY KEY(account, hash)
);
CREATE TABLE browser_auth_limits (
  key TEXT PRIMARY KEY,
  window_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
CREATE INDEX browser_auth_limits_window ON browser_auth_limits(window_at);
