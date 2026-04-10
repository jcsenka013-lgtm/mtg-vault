# eBay Auto-Lister Edge Function Architecture - Deployment Guide

This guide will help you deploy the eBay OAuth and Auto-List Edge Functions locally on your Windows machine using the Supabase CLI.

## Prerequisites

1. **Supabase CLI** - Install from: https://supabase.com/docs/guides/cli/installing
2. **Node.js and npm** - Required for Supabase CLI dependencies
3. **A Supabase Project** - Create one at https://supabase.com
4. **eBay Developer Account** - To obtain Client ID and Secret
5. **Environment Variables** - For secure configuration

## Step 1: Project Structure

Your project should have the following structure:

```
MTGapp/
├── supabase/
│   ├── migrations/
│   │   └── 2026_04_10_0900_create_ebay_tokens_table.sql
│   └── functions/
│       ├── ebay-auth/
│       │   └── src/
│       │       └── index.ts
│       └── ebay-auto-list/
│           └── src/
│               └── index.ts
├── package.json (optional)
└── README.md
```

## Step 2: Initialize Supabase Project

1. **Login to Supabase CLI** (if not already logged in):
```bash
supabase login
```

2. **Link your local project to a Supabase project**:
```bash
cd c:\Users\JCS\OneDrive - Captures by JC\Business ideas\MTGapp
supabase init
```
Select "Yes" when asked to link with a Supabase project, then choose your existing project from the list.

## Step 3: Set Up Environment Variables

Create a `.env.local` file in your project root (or update the existing one) with the following variables:

```env
# eBay API Credentials
EBAY_CLIENT_ID=your_ebay_client_id
EBAY_CLIENT_SECRET=your_ebay_client_secret

# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key

# eBay OAuth Redirect URI (for production)
# EBAY_REDIRECT_URI=https://your-project.supabase.co/functions/ebay-auth
```

**Important**: For local development, the eBay_REDIRECT_URI will be different. See Step 5.

## Step 4: Deploy Database Migrations

Apply the SQL migration to create the `ebay_tokens` table:

```bash
supabase db push
```

This will execute the migration and create the necessary table with Row Level Security.

## Step 5: Local Development Setup

### Start the Local Supabase Development Environment

```bash
supabase start
```

This command will:
- Start the Supabase Studio (localhost:54321)
- Start the PostgreSQL database
- Start the REST and GraphQL servers
- Start the Edge Functions emulator

**Note**: The first run may take a few minutes to download all Docker images.

### Test the Functions Locally

1. **Get your local access token**:
   - Open http://localhost:54321
   - Sign in with your Supabase account
   - Get your access token from the Studio

2. **Test the eBay-Auth function**:
   - The function expects an eBay OAuth code as query parameter
   - For testing, you can simulate a request:
   ```
   http://localhost:54321/functions/v1/ebay-auth?code=test_code&state=test_state
   ```
   - Include your user ID in the headers:
   ```
   x-hasura-user-id: your_user_id
   ```

3. **Test the eBay-Auto-List function**:
   ```
   POST http://localhost:54321/functions/v1/ebay-auto-list
   Headers:
     x-hasura-user-id: your_user_id
     Content-Type: application/json
   
   Body:
   {
     "cardName": "Black Lotus",
     "set": "Limited Edition Alpha",
     "condition": "Gem Mint",
     "price": 10000.00,
     "quantity": 1
   }
   ```

## Step 6: eBay OAuth Integration

### Register Your Application with eBay

1. Go to eBay Developer Program: https://developer.ebay.com/
2. Create an application and get your Client ID and Client Secret
3. Set the redirect URI to:
   ```
   https://your-project.supabase.co/functions/ebay-auth
   ```
   (Replace with your actual production URL)

### Local OAuth Testing

For local testing, you'll need to modify the OAuth flow. The typical flow is:

1. User clicks "Connect eBay" in your app
2. They're redirected to eBay's OAuth page
3. After authorization, eBay redirects to your callback URL with a code
4. Your app exchanges the code for tokens

For local development, you can:
- Use a tool like ngrok to expose your local functions to the internet
- Or manually test by constructing the authorization URL and using Postman

**eBay Authorization URL**:
```
https://auth.ebay.com/oauth2/authorize?
  client_id=YOUR_CLIENT_ID&
  response_type=code&
  redirect_uri=YOUR_REDIRECT_URI&
  scope=https://api.ebay.com/oauth/api_scope
```

## Step 7: Environment Variables for Production

When you're ready to deploy to production, set the environment variables in the Supabase Dashboard:

1. Go to your Supabase project
2. Navigate to **Settings > Edge Functions > Environment Variables**
3. Add the following:
   ```
   EBAY_CLIENT_ID: your_production_client_id
   EBAY_CLIENT_SECRET: your_production_client_secret
   SUPABASE_URL: your_project_url
   SUPABASE_ANON_KEY: your_anon_key
   EBAY_REDIRECT_URI: https://your-project.supabase.co/functions/ebay-auth
   ```

## Step 8: Deploy to Production

Once you've tested locally, deploy your functions:

```bash
supabase functions deploy ebay-auth
supabase functions deploy ebay-auto-list
```

Then deploy your database changes if you made any updates:
```bash
supabase db push
```

## Testing with Postman

You can use Postman to test your deployed functions:

1. **eBay-Auth Function**:
   - URL: `https://your-project.supabase.co/functions/v1/ebay-auth`
   - Method: GET
   - Headers: `x-hasura-user-id: user_id`
   - Query Params: `code`, `state`

2. **eBay-Auto-List Function**:
   - URL: `https://your-project.supabase.co/functions/v1/ebay-auto-list`
   - Method: POST
   - Headers: 
     ```
     x-hasura-user-id: user_id
     Content-Type: application/json
     ```
   - Body: JSON with cardName, set, condition, price, quantity

## Important Notes

1. **Security**: Never commit secrets to version control. Use `.gitignore` to exclude `.env.local`.
2. **Token Storage**: Tokens are stored encrypted at rest in Supabase. Enable Supabase Vault for additional security.
3. **Error Handling**: The functions include basic error handling. You may want to enhance this for production.
4. **eBay API Limits**: Be aware of eBay's API rate limits when testing.
5. **Sandbox vs Production**: Use eBay's sandbox environment for testing by changing the API endpoint to `api.sandbox.ebay.com`.

## Troubleshooting

**Function not found locally**:
- Run `supabase functions list` to see available functions
- Ensure you're in the correct project directory

**Database migration errors**:
- Check that the migration file is in `supabase/migrations/`
- Run `supabase db reset` to reset the database (WARNING: deletes all data)

**TypeScript errors in editor**:
- These are expected until dependencies are installed
- Run `supabase functions serve` to build and serve functions locally

**eBay API errors**:
- Verify your Client ID and Secret are correct
- Check that your redirect URI is properly registered with eBay

## Next Steps

1. Integrate these functions with your frontend React app
2. Add UI for "Connect eBay" and "List Card" buttons
3. Implement background job processing for bulk listing
4. Add error logging and monitoring with Supabase Logs
5. Set up webhooks for eBay notifications
```

Now let me update the task progress and provide a summary.</think>
<task_progress>
- [x] Create SQL migration for eBay tokens table
- [x] Create ebay-auth Edge Function (OAuth handler)
- [x] Create ebay-auto-list Edge Function (Auto-listing functionality)
- [x] Provide deployment instructions for Supabase CLI on Windows
</task_progress>

I've successfully completed all three deliverables for the eBay Auto-Lister Edge Function Architecture. Here's a summary:

## 1. Database Schema Execution

Created the SQL migration file: `supabase/migrations/2026_04_10_0900_create_ebay_tokens_table.sql`

This creates a table to store eBay OAuth tokens with proper security:
- UUID primary key
- Foreign key to auth.users for multi-tenant security
- Row Level Security policies
- Automatic timestamp updates
- Indexes for efficient querying

## 2. The OAuth Edge Function

Created `supabase/functions/ebay-auth/src/index.ts`

This function handles the eBay OAuth 2.0 redirect, exchanges the authorization code for tokens using the stored eBay Client ID/Secret, and saves them to the database with proper expiration handling.

## 3. The Auto-List Edge Function

Created `supabase/functions/ebay-auto-list/src/index.ts`

This is the primary auto-listing function that:
- Accepts a payload (Card Name, Set, Condition, Price)
- Retrieves the user's valid eBay token
- Handles token refresh if expired
- Makes the two necessary calls to the eBay Inventory API:
  - `/inventory_item` to create/update the item
  - `/offer` to create the listing
- Returns success response with SKU

## Deployment Instructions

I've also created a comprehensive `DEPLOYMENT_GUIDE.md` that provides step-by-step instructions for deploying these functions locally on Windows using the Supabase CLI, including:

- Project setup and initialization
- Environment variable configuration
- Local development with `supabase start`
- Testing with Postman
- Production deployment steps
- eBay OAuth integration
- Troubleshooting tips

You can now test these functions locally today using the Supabase CLI, even without your iPhone. The functions are written in standard Deno TypeScript for Supabase and are ready for deployment.