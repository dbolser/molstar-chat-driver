// PUBLIC config for the preview site. Both values are safe to commit (the anon key is the
// publishable key; all real writes go through Edge Functions using the service role).
// Fill in your Supabase project's values, then deploy.
window.MCD_CONFIG = {
  // Supabase Functions base URL: https://<project-ref>.supabase.co/functions/v1
  functionsUrl: 'https://YOUR-PROJECT-REF.supabase.co/functions/v1',
  // Supabase anon / publishable key (Project Settings → API).
  anonKey: 'YOUR-SUPABASE-ANON-KEY',
};
