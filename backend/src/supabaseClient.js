/**
 * SUPABASE CLIENT (backend only)
 * ---------------------------------------------------
 * We use the SECRET key here (not the publishable one) because:
 * - The backend needs to insert/read rows freely, without being limited
 *   by Row Level Security policies meant for end-user/client access.
 * - This file must NEVER be imported into frontend code, and the secret
 *   key must NEVER be committed to git or exposed to the browser.
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseSecretKey) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SECRET_KEY environment variables. Check your .env file.'
  );
}

const supabase = createClient(supabaseUrl, supabaseSecretKey);

module.exports = { supabase };