-- Disabled by default. Stores only explicit group binding, never cookies or API credentials.
CREATE TABLE muse_personal_bindings (
 channel_slug TEXT PRIMARY KEY REFERENCES channels(slug) ON DELETE CASCADE,
 owner_account TEXT NOT NULL, binding_id TEXT NOT NULL UNIQUE,
 account_label TEXT NOT NULL, sidechat_label TEXT NOT NULL, sidechat_id TEXT NOT NULL,
 last_checked_at INTEGER, report_state TEXT CHECK(report_state IN ('auth_required','ready_readonly','polling','reconnect_required','submission_unknown','disconnected')),
 reason TEXT CHECK(reason IN ('ready','session_unavailable','transport_error','pending_verification')),
 UNIQUE(owner_account,sidechat_id)
);
CREATE TABLE muse_personal_report_nonces (
 channel_slug TEXT NOT NULL REFERENCES channels(slug) ON DELETE CASCADE,
 nonce TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(channel_slug,nonce)
);
CREATE INDEX muse_personal_nonce_expiry ON muse_personal_report_nonces(expires_at);
