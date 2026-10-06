import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SYSTEM } from '../supabase/functions/_shared/prompt.ts';

test('the system prompt carries the current MVS reference (primitives, opacity, interactions)', () => {
  for (const s of ['`primitive`', 'distance_measurement', '`opacity`', '`canvas`', 'molstar_show_non_covalent_interactions', 'molstar_color_theme_name']) {
    assert.ok(SYSTEM.includes(s), s);
  }
  assert.ok(!SYSTEM.includes('selecting by distance'), 'interactions are expressible; only the distance selector is missing');
  assert.equal(SYSTEM.split('## MVS reference').length, 2);
});

test('prompt.ts is the shape scripts/sync-prompt.mjs rewrites', () => {
  const src = readFileSync(new URL('../supabase/functions/_shared/prompt.ts', import.meta.url), 'utf8');
  assert.match(src, /^(?:\/\/.*\n)*export const SYSTEM = ".*";\n$/s);
});
