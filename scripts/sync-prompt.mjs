#!/usr/bin/env node
// Re-sync the vendored MVS reference in the chat backend's system prompt from a MolBench checkout.
//
//   node scripts/sync-prompt.mjs <path/to/MolBench>
//
// `SYSTEM` = this repo's own head (instructions + "Output contract", tuned for the chat driver and
// owned here) + MolBench's `molbench/mvs_reference.md`, verbatim, after the `## MVS reference`
// heading. Only the reference is replaced; edit the head in prompt.ts directly.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const molbench = process.argv[2];
if (!molbench) {
  console.error('usage: node scripts/sync-prompt.mjs <path/to/MolBench>');
  process.exit(1);
}
const PROMPT_TS = new URL('../supabase/functions/_shared/prompt.ts', import.meta.url);
const MARK = '\n## MVS reference\n\n';

const src = readFileSync(PROMPT_TS, 'utf8');
const m = src.match(/^((?:\/\/.*\n)*)export const SYSTEM = (".*");\n$/s);
if (!m) throw new Error('prompt.ts is not in the expected `export const SYSTEM = "...";` shape');
const system = JSON.parse(m[2]);
const at = system.indexOf(MARK);
if (at === -1) throw new Error(`SYSTEM has no "${MARK.trim()}" heading`);

const reference = readFileSync(join(molbench, 'molbench', 'mvs_reference.md'), 'utf8');
const next = system.slice(0, at + MARK.length) + reference;
// JSON-escaped (and ASCII-only, like the original) so backticks / ${} / non-ASCII are all safe.
const literal = JSON.stringify(next).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
writeFileSync(PROMPT_TS, `${m[1]}export const SYSTEM = ${literal};\n`);
console.log(next === system ? 'prompt.ts already in sync' : `prompt.ts updated (${system.length} → ${next.length} chars)`);
