-- Independent, human-authorized personal-agent connections. Secrets are AES-GCM
-- ciphertext with AAD binding them to their owning channel and connection.
CREATE TABLE IF NOT EXISTS personal_agent_conversation_channels (
  remote_binding TEXT PRIMARY KEY,
  channel_slug TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (remote_binding, channel_slug)
);
CREATE TABLE IF NOT EXISTS cloud_agent_connections (
  id TEXT NOT NULL,
  channel_slug TEXT NOT NULL,
  owner_account TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('hermes', 'manus')),
  name TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  remote_agent_id TEXT,
  remote_conversation_id TEXT,
  remote_binding TEXT,
  session_id TEXT,
  credential_ciphertext TEXT NOT NULL,
  agent_token_ciphertext TEXT NOT NULL,
  agent_token_hash TEXT NOT NULL,
  personal_context_acknowledged INTEGER NOT NULL DEFAULT 0,
  supports_cancel INTEGER NOT NULL DEFAULT 0,
  verified_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (channel_slug, id),
  FOREIGN KEY (channel_slug) REFERENCES channels(slug) ON DELETE CASCADE,
  FOREIGN KEY (remote_binding, channel_slug) REFERENCES personal_agent_conversation_channels(remote_binding, channel_slug)
);
-- A personal Manus conversation must never silently bridge two groups.
CREATE UNIQUE INDEX IF NOT EXISTS cloud_agent_remote_binding
  ON cloud_agent_connections(remote_binding) WHERE revoked_at IS NULL AND remote_binding IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cloud_agent_name
  ON cloud_agent_connections(channel_slug, name) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS cloud_agent_runs (
  id TEXT PRIMARY KEY,
  channel_slug TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('starting','running','needs_input','submitted','completed','failed','cancelled','unknown')),
  prompt TEXT NOT NULL,
  remote_run_id TEXT,
  reference_json TEXT,
  result TEXT,
  error TEXT,
  reply_message_seq INTEGER,
  lease_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (channel_slug, connection_id, request_id),
  FOREIGN KEY (channel_slug, connection_id) REFERENCES cloud_agent_connections(channel_slug, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS cloud_agent_one_active_run
  ON cloud_agent_runs(channel_slug, connection_id)
  WHERE state IN ('starting','running','needs_input','unknown');
CREATE INDEX IF NOT EXISTS cloud_agent_runs_recent
  ON cloud_agent_runs(channel_slug, connection_id, created_at DESC);

CREATE TABLE IF NOT EXISTS channel_repositories (
  id TEXT PRIMARY KEY,
  channel_slug TEXT NOT NULL,
  full_name TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  is_private INTEGER NOT NULL,
  credential_ciphertext TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (channel_slug, full_name),
  FOREIGN KEY (channel_slug) REFERENCES channels(slug) ON DELETE CASCADE
);
