#!/usr/bin/env node
// Mint evaluator invite links.
//
// Generates a high-entropy UUID token per evaluator, seeds it into the `evaluators` allowlist
// (so — and only so — the `chat`/`capture` Edge Functions will serve it), and prints the secret
// `?e=<token>` link to hand out. Re-running is safe: existing tokens are left untouched.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SITE_URL=https://you.github.io/molstar-chat-driver \
//     node scripts/mint-invites.mjs "Ada Lovelace" "Rosalind Franklin"
//   # or generate N anonymous tokens:
//   node scripts/mint-invites.mjs --count 5
//
// Env:
//   SUPABASE_URL               project URL, e.g. https://<ref>.supabase.co  (local: http://127.0.0.1:54321)
//   SUPABASE_SERVICE_ROLE_KEY  service-role / secret key (NOT the anon key)
//   SITE_URL                   public site base URL for the printed links (optional)
// Flags:
//   --count N    mint N anonymous invites (instead of named ones)
//   --dry-run    generate + print links without writing to the database

import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const countIdx = args.findIndex((a) => a === '--count' || a === '-n');
let names = [];
if (countIdx !== -1) {
  const n = Number(args[countIdx + 1]);
  if (!Number.isInteger(n) || n < 1) {
    console.error('--count needs a positive integer');
    process.exit(1);
  }
  names = Array.from({ length: n }, () => null); // anonymous; evaluator fills their name in the gate
} else {
  names = args.filter((a) => !a.startsWith('-'));
}
if (names.length === 0) {
  console.error('Usage: node scripts/mint-invites.mjs "Name One" "Name Two"   (or: --count N)');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');

const invites = names.map((name) => ({ token: randomUUID(), name }));

if (!dryRun) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or pass --dry-run).');
    process.exit(1);
  }
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/evaluators`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
      Prefer: 'return=minimal,resolution=ignore-duplicates',
    },
    body: JSON.stringify(invites.map(({ token, name }) => ({ token, name }))),
  });
  if (!res.ok) {
    console.error(`Failed to seed evaluators: HTTP ${res.status}\n${await res.text()}`);
    process.exit(1);
  }
  console.error(`✓ seeded ${invites.length} invite(s) into evaluators\n`);
} else {
  console.error('(dry run — not writing to the database)\n');
}

for (const { token, name } of invites) {
  const link = SITE_URL ? `${SITE_URL}/?e=${token}` : `?e=${token}`;
  console.log(name ? `${name}\t${link}` : link);
}
