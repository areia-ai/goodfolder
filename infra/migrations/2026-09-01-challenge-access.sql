-- Add a revocable, time-bounded access grant for the WebMCP Challenge.
-- It is not billing and must never create a provider subscription.
CREATE TABLE IF NOT EXISTS campaign_access_redemptions (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  campaign TEXT NOT NULL,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (account_id, campaign)
);
CREATE INDEX IF NOT EXISTS campaign_access_redemptions_current
  ON campaign_access_redemptions (account_id, expires_at DESC);
