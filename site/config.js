// PUBLIC config for the preview site. Both values are safe to commit: the anon/publishable key
// only gets a request past the Supabase gateway — all real auth is the per-evaluator invite
// token, and all writes go through Edge Functions using the service role.
// Fill in your Supabase project's values, then deploy.
window.MCD_CONFIG = {
  // Supabase Functions base URL: https://<project-ref>.supabase.co/functions/v1
  functionsUrl: 'https://YOUR-PROJECT-REF.supabase.co/functions/v1',
  // Supabase anon / publishable key (Project Settings → API). Sent as the `apikey` header.
  anonKey: 'YOUR-SUPABASE-ANON-KEY',
};
