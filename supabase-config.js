const SUPABASE_URL = "https://vfetdrnifhvavqfjgkjg.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_eQZD4ZNS9ghbKdHl5kPOdw_ds8mYKVS";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);