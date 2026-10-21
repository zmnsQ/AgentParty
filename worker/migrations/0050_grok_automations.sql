-- A Grok Automation webhook is NOT equivalent to a direct personal Grok Bot API.
-- Only owners may configure a verified deployment-allowlisted HTTPS trigger.
CREATE TABLE grok_automation_connections (
  channel_slug TEXT PRIMARY KEY REFERENCES channels(slug) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  endpoint_ciphertext TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  configured_by TEXT NOT NULL,
  configured_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE grok_automation_deliveries (
  id TEXT PRIMARY KEY,
  channel_slug TEXT NOT NULL REFERENCES channels(slug) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  prompt TEXT NOT NULL,
  webhook_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('submitting','submitted','rejected','unknown')),
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(channel_slug,request_id)
);
CREATE INDEX grok_delivery_recent ON grok_automation_deliveries(channel_slug, created_at DESC);
