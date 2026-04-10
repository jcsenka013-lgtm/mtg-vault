-- Create tables for eBay integration

-- Table 1: Stores per-user eBay OAuth tokens
CREATE TABLE IF NOT EXISTS public.ebay_tokens (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  access_token              TEXT NOT NULL,
  refresh_token             TEXT NOT NULL,

  access_token_expires_at   TIMESTAMPTZ NOT NULL,
  refresh_token_expires_at  TIMESTAMPTZ NOT NULL,

  ebay_user_id              TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id)
);

-- Table 2: Stores the user's eBay seller configuration
CREATE TABLE IF NOT EXISTS public.ebay_seller_config (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  merchant_location_key    TEXT NOT NULL,
  fulfillment_policy_id    TEXT NOT NULL,
  payment_policy_id        TEXT NOT NULL,
  return_policy_id         TEXT NOT NULL,
  default_currency         TEXT NOT NULL DEFAULT 'USD',
  default_marketplace      TEXT NOT NULL DEFAULT 'EBAY_US',

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id)
);

-- Enable RLS
ALTER TABLE public.ebay_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ebay_seller_config ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can manage their own ebay tokens" ON public.ebay_tokens
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own ebay config" ON public.ebay_seller_config
  FOR ALL USING (auth.uid() = user_id);

-- Helper table for OAuth state management (CSRF protection)
CREATE TABLE IF NOT EXISTS public.ebay_auth_states (
  state       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes')
);

ALTER TABLE public.ebay_auth_states ENABLE ROW LEVEL SECURITY;
-- No public access to states table, only via service role in Edge Functions
