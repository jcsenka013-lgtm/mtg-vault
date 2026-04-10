// eBay OAuth Callback Function for Supabase Edge Functions
// Handles the OAuth 2.0 redirect from eBay and stores tokens in the database

// Import the Supabase Edge Function client
import { createClient } from '@supabase/db-client';

// eBay API configuration - these should be stored in Supabase Vault or environment variables
const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID!;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET!;
const EBAY_REDIRECT_URI = process.env.EBAY_REDIRECT_URI!; // e.g., https://your-project.supabase.co/functions/ebay-auth

// eBay API endpoints
const EBAY_TOKEN_ENDPOINT = 'https://api.ebay.com identity/v1/oauth2/token';

interface TokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    scope: string;
}

// Helper function to exchange authorization code for tokens
async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: EBAY_REDIRECT_URI,
    });

    const response = await fetch(EBAY_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64'),
        },
        body,
    });

    if (!response.ok) {
        throw new Error(`Failed to exchange code for tokens: ${response.status} ${await response.text()}`);
    }

    return response.json();
}

// Helper function to refresh access token using refresh token
async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
    });

    const response = await fetch(EBAY_TOKEN_ENDPOINT, {
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

// Main handler for OAuth callback
export default async function (req: Request): Promise<Response> {
    try {
        const supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_ANON_KEY!
        );

        // Parse query parameters from the request
        const url = new URL(req.url);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');

        if (!code) {
            return new Response(JSON.stringify({ error: 'Missing authorization code' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Exchange authorization code for tokens
        const tokens = await exchangeCodeForTokens(code);

        // Calculate expiration time (subtract 5 minutes for safety)
        const expiresAt = new Date();
        expiresAt.setSeconds(expiresAt.getSeconds() + tokens.expires_in - 300);

        // Get the user ID from the request context (Supabase Edge Functions automatically handle auth)
        const userId = req.headers.get('x-hasura-user-id');

        if (!userId) {
            return new Response(JSON.stringify({ error: 'Unauthenticated user' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Upsert the tokens in the database
        await supabase.from('ebay_tokens').upsert({
            user_id: userId,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: expiresAt,
            token_type: tokens.token_type,
            scope: tokens.scope,
        });

        // Return success response with a redirect URL (typically to a frontend page)
        const redirectUrl = state || '/profile';
        const responseBody = JSON.stringify({
            success: true,
            message: 'Tokens saved successfully',
            redirect: redirectUrl,
        });

        return new Response(responseBody, {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Location': redirectUrl // For HTTP redirect if needed
            }
        });

    } catch (error) {
        console.error('Error in ebay-auth function:', error);
        const errorBody = JSON.stringify({
            error: 'Failed to authenticate with eBay',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
        return new Response(errorBody, {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}