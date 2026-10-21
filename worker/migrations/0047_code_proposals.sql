-- Immutable review snapshots. Provider write credentials are never persisted here.
CREATE TABLE IF NOT EXISTS code_change_proposals (
  id TEXT PRIMARY KEY,
  channel_slug TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  digest TEXT NOT NULL,
  files_json TEXT NOT NULL,
  originals_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'proposed'
    CHECK (state IN ('proposed','publishing','published','rejected','failed','unknown')),
  approved_by TEXT,
  approved_at INTEGER,
  branch TEXT,
  commit_sha TEXT,
  pull_request_url TEXT,
  pull_request_number INTEGER,
  error TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(repository_id, created_by_hash, request_id),
  FOREIGN KEY(channel_slug) REFERENCES channels(slug) ON DELETE CASCADE,
  FOREIGN KEY(repository_id) REFERENCES channel_repositories(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS code_change_proposals_recent
  ON code_change_proposals(channel_slug, repository_id, created_at DESC);
