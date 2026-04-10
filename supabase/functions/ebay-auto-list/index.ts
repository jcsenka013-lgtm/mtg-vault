import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { getValidAccessToken } from "../_shared/ebay-token-helper.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CATEGORY_MAP = {
  "MTG": "2536",
  "Pokemon": "183454",
};

const CONDITION_MAP = {
  "NM": "LIKE_NEW",
  "LP": "VERY_GOOD",
  "MP": "GOOD",
  "HP": "ACCEPTABLE",
  "DMG": "FOR_PARTS_OR_NOT_WORKING",
};

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    // 1. Auth & Config Load
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const payload = await req.json();
    const userId = user.id;

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const [configRes, tokenRes] = await Promise.all([
      supabaseAdmin.from("ebay_seller_config").select("*").eq("user_id", userId).single(),
      supabaseAdmin.from("ebay_tokens").select("*").eq("user_id", userId).single(),
    ]);

    if (configRes.error || !configRes.data) {
      throw new Error("eBay seller config not found. Please complete setup in settings.");
    }
    if (tokenRes.error || !tokenRes.data) {
      throw new Error("eBay account not connected.");
    }

    const sellerConfig = configRes.data;
    const tokenRow = tokenRes.data;

    // 2. Token Refresh Guard
    const accessToken = await getValidAccessToken(supabaseAdmin, tokenRow);

    const isSandbox = Deno.env.get("EBAY_ENVIRONMENT") === "sandbox";
    const apiBase = isSandbox ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";

    // 3. Build SKU & Inventory Item
    const sku = `${payload.scryfall_id}-${payload.condition}-${payload.is_foil ? "foil" : "nonfoil"}`;
    
    const inventoryItem = {
      availability: {
        shipToLocationAvailability: { quantity: payload.quantity }
      },
      condition: CONDITION_MAP[payload.condition as keyof typeof CONDITION_MAP] || "LIKE_NEW",
      product: {
        title: `${payload.name} - ${payload.set_name} (${payload.set_code.toUpperCase()}) ${payload.condition} ${payload.is_foil ? "Foil" : ""}`,
        description: `Listing for ${payload.name} from ${payload.set_name}. Condition is ${payload.condition}.`,
        imageUrls: payload.image_uri ? [payload.image_uri] : [],
        aspects: {
          "Game": [payload.game_type === "MTG" ? "Magic: The Gathering" : "Pokémon"],
          "Card Name": [payload.name],
          "Set": [payload.set_name],
          "Rarity": [capitalize(payload.rarity)],
          "Finish": [payload.is_foil ? (payload.game_type === "MTG" ? "Foil" : "Holo") : "Regular"],
          "Language": ["English"],
          "Condition": [payload.condition],
        }
      }
    };

    // 4. API Call 1: PUT Inventory Item
    const invRes = await fetch(`${apiBase}/sell/inventory/v1/inventory_item/${sku}`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
      },
      body: JSON.stringify(inventoryItem),
    });

    if (invRes.status !== 204 && invRes.status !== 200) {
      const error = await invRes.json();
      throw new Error(`eBay Inventory Error: ${JSON.stringify(error)}`);
    }

    // 5. Build Offer
    const offerBody = {
      sku: sku,
      marketplaceId: sellerConfig.default_marketplace,
      format: "FIXED_PRICE",
      availableQuantity: payload.quantity,
      categoryId: CATEGORY_MAP[payload.game_type as keyof typeof CATEGORY_MAP],
      listingDescription: inventoryItem.product.description,
      pricingSummary: {
        price: {
          value: payload.listing_price_usd.toFixed(2),
          currency: sellerConfig.default_currency
        }
      },
      listingPolicies: {
        fulfillmentPolicyId: sellerConfig.fulfillment_policy_id,
        paymentPolicyId: sellerConfig.payment_policy_id,
        returnPolicyId: sellerConfig.return_policy_id
      },
      merchantLocationKey: sellerConfig.merchant_location_key
    };

    // 6. API Call 2: Create Offer
    const offerRes = await fetch(`${apiBase}/sell/inventory/v1/offer`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
      },
      body: JSON.stringify(offerBody),
    });

    if (!offerRes.ok) {
      const error = await offerRes.json();
      throw new Error(`eBay Offer Error: ${JSON.stringify(error)}`);
    }

    const { offerId } = await offerRes.json();

    // 7. API Call 3: Publish Offer
    const publishRes = await fetch(`${apiBase}/sell/inventory/v1/offer/${offerId}/publish`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!publishRes.ok) {
      const error = await publishRes.json();
      throw new Error(`eBay Publish Error: ${JSON.stringify(error)}`);
    }

    const { listingId } = await publishRes.json();

    return new Response(JSON.stringify({
      success: true,
      listingId,
      listingUrl: `https://www.ebay.com/itm/${listingId}`,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("eBay Auto-List Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
