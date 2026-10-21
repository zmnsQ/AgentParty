-- OAuth 2.1 DCR, explicit GitHub-human group consent, PKCE and rotating
-- per-group agent credentials for MCP clients (not model API credentials).
CREATE TABLE connector_oauth_clients(
  client_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirects_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  disabled_at INTEGER
);
CREATE TABLE connector_oauth_pending(
  id TEXT PRIMARY KEY,
  nonce_hash TEXT NOT NULL,
  browser_session_id TEXT NOT NULL,
  account TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES connector_oauth_clients(client_id),
  channel_slug TEXT NOT NULL REFERENCES channels(slug) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  state TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX connector_oauth_pending_expires ON connector_oauth_pending(expires_at);
CREATE TABLE connector_oauth_grants(
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES connector_oauth_clients(client_id),
  account TEXT NOT NULL,
  channel_slug TEXT NOT NULL REFERENCES channels(slug) ON DELETE CASCADE,
  agent_name TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  resource TEXT NOT NULL,
  access_hash TEXT UNIQUE,
  access_expires_at INTEGER NOT NULL DEFAULT 0,
  refresh_hash TEXT UNIQUE,
  refresh_expires_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER,
  UNIQUE(client_id,account,channel_slug)
);
CREATE TABLE connector_oauth_codes(
  code_hash TEXT PRIMARY KEY,
  pending_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  account TEXT NOT NULL,
  channel_slug TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX connector_oauth_codes_expiry ON connector_oauth_codes(expires_at);
