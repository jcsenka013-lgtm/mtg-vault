import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return new Response("Missing code or state", { status: 400 });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // 1. Validate state and get user_id
  const { data: stateData, error: stateError } = await supabaseAdmin
    .from("ebay_auth_states")
    .select("user_id")
    .eq("state", state)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (stateError || !stateData) {
    return new Response("Invalid or expired state", { status: 400 });
  }

  const userId = stateData.user_id;

  // 2. Delete state record (one-time use)
  await supabaseAdmin.from("ebay_auth_states").delete().eq("state", state);

  // 3. Exchange code for tokens
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  const redirectUri = Deno.env.get("EBAY_REDIRECT_URI");
  
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
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri!,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("eBay token exchange failed:", errorText);
    return new Response("Token exchange failed", { status: 500 });
  }

  const tokenData = await response.json();

  // 4. Save tokens to DB
  const { error: upsertError } = await supabaseAdmin
    .from("ebay_tokens")
    .upsert({
      user_id: userId,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      access_token_expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
      refresh_token_expires_at: new Date(Date.now() + tokenData.refresh_token_expires_in * 1000).toISOString(),
    });

  if (upsertError) {
    console.error("Failed to save eBay tokens:", upsertError);
    return new Response("Database error", { status: 500 });
  }

  // 5. Redirect back to app
  const appRedirectUrl = "mtgvault://ebay-connected?status=success";
  return new Response(null, {
    status: 302,
    headers: {
      "Location": appRedirectUrl,
    },
  });
});
