-- Create table for storing eBay OAuth tokens
CREATE TABLE IF NOT EXISTS ebay_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  token_type VARCHAR(50) NOT NULL,
  scope VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups by user
CREATE INDEX IF NOT EXISTS idx_ebay_tokens_user_id ON ebay_tokens(user_id);

-- Create index for finding valid tokens
CREATE INDEX IF NOT EXISTS idx_ebay_tokens_valid ON ebay_tokens(expires_at) WHERE expires_at > NOW();

-- Row Level Security (RLS) policies
ALTER TABLE ebay_tokens ENABLE ROW LEVEL SECURITY;

-- Policy to allow users to manage their own tokens
CREATE POLICY "Users can manage their own ebay_tokens" ON ebay_tokens
  FOR ALL USING (auth.uid() = user_id);

-- Function to update updated_at timestamp on row modification
CREATE OR REPLACE FUNCTION update_updated_at_column()
  RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to update updated_at on row modification
CREATE TRIGGER update_updated_at BEFORE UPDATE ON ebay_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();