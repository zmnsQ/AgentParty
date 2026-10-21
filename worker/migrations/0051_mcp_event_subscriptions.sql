-- MCP 2.0 webhook subscriptions for specific, authorized group agents only.
-- The worker accepts only operator-approved HTTPS callback origins.
CREATE TABLE mcp_event_subscriptions (
  id TEXT PRIMARY KEY,
  channel_slug TEXT NOT NULL REFERENCES channels(slug) ON DELETE CASCADE,
  owner_account TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  agent_token_hash TEXT NOT NULL,
  name TEXT NOT NULL CHECK(name='message.created'),
  filter_json TEXT NOT NULL,
  callback_fingerprint TEXT NOT NULL,
  callback_ciphertext TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX mcp_event_subscriptions_group ON mcp_event_subscriptions(channel_slug,expires_at);
CREATE TABLE mcp_event_outbox (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES mcp_event_subscriptions(id) ON DELETE CASCADE,
  channel_slug TEXT NOT NULL,
  message_seq INTEGER NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','delivered','failed','revoked')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  last_status INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(subscription_id,message_seq)
);
CREATE INDEX mcp_event_outbox_due ON mcp_event_outbox(channel_slug,state,next_attempt_at);
