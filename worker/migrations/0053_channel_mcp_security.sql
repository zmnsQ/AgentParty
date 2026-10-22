-- MCP URLs identify a group, never authorize access. External MCP is opt-in.
-- Existing chat rooms, CLI clients, URLs and local-agent credentials are unchanged.
CREATE TABLE channel_mcp_security (
  channel_slug TEXT PRIMARY KEY REFERENCES channels(slug) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  allow_write INTEGER NOT NULL DEFAULT 0 CHECK(allow_write IN (0,1)),
  allow_events INTEGER NOT NULL DEFAULT 0 CHECK(allow_events IN (0,1)),
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
