-- Each request owns a unique lease token. A superseded request must not save
-- an outcome, publish a group reply, or release a newer request's lease.
-- Existing in-flight leases retain their deadline; new requests acquire tokens.
ALTER TABLE cloud_agent_runs ADD COLUMN lease_token TEXT;
ALTER TABLE code_change_proposals ADD COLUMN lease_token TEXT;

-- Revoked connections retain their audit identity, not reusable secret copies.
UPDATE cloud_agent_connections
SET credential_ciphertext = '', agent_token_ciphertext = ''
WHERE revoked_at IS NOT NULL;
