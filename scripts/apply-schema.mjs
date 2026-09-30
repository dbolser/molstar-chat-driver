#!/usr/bin/env node
// Re-run supabase/schema.sql against a hosted project through the Management API.
//
//   node scripts/apply-schema.mjs --project-ref <ref>
//
// The service-role key can't run DDL, and `supabase db push` wants Docker + a linked repo; the
// Management API just wants the access token `npx supabase login` already stored. schema.sql is
// idempotent (create/alter … if not exists), so this is safe to run after every upgrade.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const flag = process.argv.indexOf('--project-ref');
const ref = flag === -1 ? undefined : process.argv[flag + 1];
if (!ref || ref.startsWith('--')) {
  console.error('usage: node scripts/apply-schema.mjs --project-ref <ref>');
  process.exit(2);
}
// `supabase login` keeps the token in the OS keychain when it can and falls back to this file;
// on a headless box it's the file. Otherwise pass SUPABASE_ACCESS_TOKEN (an `sbp_…` token).
const tokenFile = join(homedir(), '.supabase', 'access-token');
const token = process.env.SUPABASE_ACCESS_TOKEN ?? (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : '');
if (!token) {
  console.error(`no access token: set SUPABASE_ACCESS_TOKEN, or run \`npx supabase login\` so ${tokenFile} exists`);
  process.exit(2);
}
const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${text}`);
  process.exit(1);
}
console.log(`applied supabase/schema.sql to ${ref} (${sql.split('\n').length} lines) → ${text}`);
