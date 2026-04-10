import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

export async function getValidAccessToken(supabaseAdmin: any, tokenRow: any) {
  const BUFFER_MS = 5 * 60 * 1000; // 5 minutes
  const expiry = new Date(tokenRow.access_token_expires_at).getTime();
  const now = Date.now();

  if (expiry > now + BUFFER_MS) {
    return tokenRow.access_token;
  }

  // Token is expired or nearly expired, refresh it
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  const isSandbox = Deno.env.get("EBAY_ENVIRONMENT") === "sandbox";
  
  const tokenUrl = isSandbox 
    ? "https://api.sandbox.ebay.com/identity/v1/oauth2/token" 
    : "https://api.ebay.com/identity/v1/oauth2/token";

  const credentials = btoa(`${clientId}:${clientSecret}`);

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokenRow.refresh_token,
      scope: [
        "https://api.ebay.com/oauth/api_scope/sell.inventory",
        "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
        "https://api.ebay.com/oauth/api_scope/sell.marketing.readonly",
        "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
      ].join(" "),
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    console.error("eBay token refresh failed:", errorData);
    
    if (errorData.error === "invalid_grant") {
      // Refresh token itself expired
      await supabaseAdmin
        .from("ebay_tokens")
        .update({ access_token: null, refresh_token: null })
        .eq("user_id", tokenRow.user_id);
      throw new Error("eBay refresh token expired. Please reconnect.");
    }
    
    throw new Error("Failed to refresh eBay token");
  }

  const tokenData = await response.json();
  const newAccessToken = tokenData.access_token;
  const newExpiry = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

  // Update DB
  const { error: updateError } = await supabaseAdmin
    .from("ebay_tokens")
    .update({
      access_token: newAccessToken,
      access_token_expires_at: newExpiry,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", tokenRow.user_id);

  if (updateError) {
    console.error("Failed to update eBay tokens in DB:", updateError);
  }

  return newAccessToken;
}
