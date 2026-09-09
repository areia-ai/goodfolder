-- Folder tokens used to expire after thirty days with nothing to renew them,
-- so every connected folder stopped saving a month after it was set up. A
-- folder now renews its own token before it runs out: a fresh token is issued
-- for the same device and the old one is given a few minutes' grace, which
-- needs two rows per device for a moment. The one-token-per-device rule goes;
-- an index takes its place.
ALTER TABLE transfer_tokens DROP CONSTRAINT IF EXISTS transfer_tokens_device_id_key;
CREATE INDEX IF NOT EXISTS transfer_tokens_device ON transfer_tokens (device_id);

-- Tokens already issued get the same lifetime new ones do, counted from now,
-- so nothing connected before this change stops working before it renews.
UPDATE transfer_tokens SET expires_at = now() + interval '90 days'
  WHERE expires_at > now() AND expires_at < now() + interval '90 days';
