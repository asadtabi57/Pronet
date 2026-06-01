// Supabase public config — safe to commit; the publishable key is client-side.
window.SUPABASE_URL = 'https://blycpujwjxlhpxcnlhtd.supabase.co';
window.SUPABASE_KEY = 'sb_publishable_0ujr8vfRd4xxwU2_5svIHg_s3voW9wg';
window.sb = window.supabase && window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
