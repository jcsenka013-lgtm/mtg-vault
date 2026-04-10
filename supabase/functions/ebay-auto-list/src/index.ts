// eBay Auto-List Function for Supabase Edge Functions
// Accepts a payload (Card Name, Set, Condition, Price), retrieves user's token, handles refresh, and lists item on eBay

import { createClient } from '@supabase/db-client';

// eBay API configuration - these should be stored in Supabase Vault or environment variables
const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID!;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET!;

// eBay API endpoints
const EBAY_PRODUCTION_ENDPOINT = 'https://api.ebay.com';
const EBAY_SANDBOX_ENDPOINT = 'https://api.sandbox.ebay.com';

interface ListRequest {
    cardName: string;
    set: string;
    condition: string;
    price: number;
    quantity?: number;
}

// Helper function to get user's token and refresh if expired
async function getUserToken(supabase: any, userId: string) {
    const currentTime = new Date();

    // Get token for the user
    const tokenResult = await supabase.from('ebay_tokens').select('access_token', 'refresh_token', 'expires_at').eq('user_id', userId).single();

    if (tokenResult.error) {
        throw new Error(`Failed to get token: ${tokenResult.error.message}`);
    }

    const token = tokenResult;

    // Check if token is expired (subtract 5 minutes buffer)
    if (new Date(token.expires_at) <= currentTime) {
        // Token expired, refresh it
        const refreshedTokens = await refreshAccessToken(token.refresh_token);

        // Update the token in the database
        const updatedResult = await supabase.from('ebay_tokens').update({
            access_token: refreshedTokens.access_token,
            refresh_token: refreshedTokens.refresh_token,
            expires_at: new Date(currentTime.getTime() + refreshedTokens.expires_in * 1000 - 300000),
            token_type: refreshedTokens.token_type,
            scope: refreshedTokens.scope,
        }).eq('user_id', userId).select().single();

        return updatedResult;
    }

    return token;
}

// Helper function to refresh access token using refresh token
async function refreshAccessToken(refreshToken: string): Promise<any> {
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
    });

    const response = await fetch(`${EBAY_PRODUCTION_ENDPOINT}/identity/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64'),
        },
        body,
    });

    if (!response.ok) {
        throw new Error(`Failed to refresh token: ${response.status} ${await response.text()}`);
    }

    return response.json();
}

// Helper function to create or update inventory item on eBay
async function createOrUpdateInventoryItem(ebayAccessToken: string, payload: ListRequest): Promise<any> {
    const inventoryItem = {
        "sku": `mtg-${payload.set}-${payload.cardName.replace(/\s+/g, '-').toLowerCase()}-${payload.condition}`,
        "product": {
            "title": `${payload.cardName} (${payload.set}) - ${payload.condition}`,
            "aspects": {
                "Brand": ["Magic the Gathering"],
                "Card Name": [payload.cardName],
                "Set": [payload.set],
                "Condition": [payload.condition]
            }
        },
        "availability": {
            "availability_type": "LIMITED",
            "quantity": payload.quantity || 1
        },
        "price": {
            "value": payload.price,
            "currency": "USD"
        },
        "format": "FIXED_PRICE",
        "listing_description": `Official Magic: The Gathering card. Ships quickly and securely. Condition as described.`
    };

    const response = await fetch(`${EBAY_PRODUCTION_ENDPOINT}/sell/inventory/v1/inventory_item`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ebayAccessToken}`,
            'X-EBAY-CATEGORY-ID': '1500' // Collectibles > Trading Cards > CCGs
        },
        body: JSON.stringify(inventoryItem),
    });

    if (!response.ok) {
        throw new Error(`Failed to create inventory item: ${response.status} ${await response.text()}`);
    }

    return response.json();
}

// Helper function to create offer for the inventory item
async function createOffer(ebayAccessToken: string, sku: string, payload: ListRequest): Promise<void> {
    const offer = {
        "sku": sku,
        "marketplace_id": "1", // eBay US
        "format": "FIXED_PRICE",
        "listing_description": `Official Magic: The Gathering card. Ships quickly and securely. Condition as described.`,
        "start_price": payload.price,
        "end_time": new Date(Date.now() + 604800000).toISOString(), // 7 days from now
        "listing_type": "FIXED_PRICE",
        "available_quantity": payload.quantity || 1,
        "auto_relist": true
    };

    const response = await fetch(`${EBAY_PRODUCTION_ENDPOINT}/sell/fulfillment/v1/offer`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ebayAccessToken}`,
        },
        body: JSON.stringify(offer),
    });

    if (!response.ok) {
        throw new Error(`Failed to create offer: ${response.status} ${await response.text()}`);
    }

    return response.json();
}

// Main handler for auto-listing
export default async function (req: Request): Promise<Response> {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json', 'Allow': 'POST' }
        });
    }

    try {
        const supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_ANON_KEY!
        );

        // Get user ID from request context
        const userId = req.headers.get('x-hasura-user-id');
        if (!userId) {
            return new Response(JSON.stringify({ error: 'Unauthenticated user' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Parse request body
        const body = await req.json();
        const listRequest: ListRequest = body;

        // Validate required fields
        if (!listRequest.cardName || !listRequest.set || !listRequest.condition || listRequest.price === undefined) {
            return new Response(JSON.stringify({ error: 'Missing required fields' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Get user's eBay token (refresh if needed)
        const tokenData = await getUserToken(supabase, userId);
        const ebayAccessToken = tokenData.access_token;

        // Create or update inventory item
        const inventoryItem = await createOrUpdateInventoryItem(ebayAccessToken, listRequest);

        // Create offer for the item
        await createOffer(ebayAccessToken, inventoryItem.sku, listRequest);

        // Return success response
        return new Response(JSON.stringify({
            success: true,
            message: 'Item listed successfully on eBay',
            sku: inventoryItem.sku,
            inventory_item: inventoryItem,
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Error in ebay-auto-list function:', error);
        const errorBody = JSON.stringify({
            error: 'Failed to list item on eBay',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
        return new Response(errorBody, {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}