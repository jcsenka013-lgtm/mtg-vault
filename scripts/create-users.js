const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Manually parse .env.local to avoid needing the dotenv package
const envPath = path.join(__dirname, '../.env.local');
let supabaseUrl = '';
let supabaseKey = '';

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, ...values] = line.split('=');
    if (key === 'EXPO_PUBLIC_SUPABASE_URL') supabaseUrl = values.join('=').trim();
    if (key === 'EXPO_PUBLIC_SUPABASE_ANON_KEY') supabaseKey = values.join('=').trim();
  });
}

// Fallback to process.env if available
supabaseUrl = supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL;
supabaseKey = supabaseKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const users = [
  { email: "jc@thevault.com", password: "planeswalker123", name: "JC" },
  { email: "leslie@thevault.com", password: "planeswalker123", name: "Leslie" },
  { email: "ben@thevault.com", password: "planeswalker123", name: "Ben" },
  { email: "richard@thevault.com", password: "planeswalker123", name: "Richard" },
  { email: "garrett@thevault.com", password: "planeswalker123", name: "Garrett" },
  { email: "brian@thevault.com", password: "planeswalker123", name: "Brian" },
  { email: "guest@thevault.com", password: "planeswalker123", name: "Guest" }
];

async function createUsers() {
  console.log('Creating predefined Vault users...');

  for (const u of users) {
    console.log(`Creating ${u.name}...`);
    const { data, error } = await supabase.auth.signUp({
      email: u.email,
      password: u.password,
      options: {
        data: {
          name: u.name,
        }
      }
    });

    if (error) {
      console.error(`Error creating ${u.name}:`, error.message);
    } else {
      console.log(`Success: ${u.name} created!`);
    }
  }

  console.log('\nDONE!');
  console.log('IMPORTANT: If Email Confirmations are ON in your Supabase project, you must manually confirm these users in the Supabase Dashboard, or turn off Email Confirmations before running this script again.');
}

createUsers();
