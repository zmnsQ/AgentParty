-- Private Muse OAuth clients are provisioned only by a verified human group owner.
-- Existing ChatGPT DCR clients and grants are unchanged.
CREATE TABLE connector_oauth_private_clients (
  client_id TEXT PRIMARY KEY REFERENCES connector_oauth_clients(client_id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider='muse'),
  owner_account TEXT NOT NULL,
  channel_slug TEXT NOT NULL REFERENCES channels(slug) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX connector_oauth_private_scope ON connector_oauth_private_clients(channel_slug,owner_account);
