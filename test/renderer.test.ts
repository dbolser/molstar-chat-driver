import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUmdRenderer, MolstarUmd } from '../src/renderer';

// A stand-in for the Mol* UMD bundle: `fromMVSJ` parses, `validationIssues` is scripted, and
// `loadMVS` resolves (as the real one does) while leaving whatever cells we seed in the state.
function fakeMolstar(opts: { issues?: string[]; cells?: { status: string; errorText?: string; id: string }[] }) {
  const cells = new Map((opts.cells ?? []).map((c, i) => [String(i), { status: c.status, errorText: c.errorText, transform: { transformer: { id: c.id } } }]));
  const plugin = { state: { data: { cells } } };
  let loaded = 0;
  const molstar: MolstarUmd = {
    PluginExtensions: {
      mvs: {
        MVSData: { fromMVSJ: (t) => JSON.parse(t), validationIssues: () => opts.issues },
        loadMVS: async () => { loaded++; },
      },
    },
  };
  return { molstar, viewer: { plugin }, loads: () => loaded };
}
const MVSJ = JSON.stringify({ metadata: { version: '1' }, root: { kind: 'root' } });

test('a valid scene that renders resolves', async () => {
  const f = fakeMolstar({ cells: [{ status: 'ok', id: 'ms-plugin.download' }] });
  await createUmdRenderer(f.molstar, f.viewer).loadMvsj(MVSJ);
  assert.equal(f.loads(), 1);
});

test('validation issues are reported before loading, in one readable line', async () => {
  const f = fakeMolstar({ issues: ['Invalid parameters for node of kind "color":\n  "spectrum" is not a valid color name'] });
  await assert.rejects(createUmdRenderer(f.molstar, f.viewer).loadMvsj(MVSJ), /Invalid scene: Invalid parameters for node of kind "color": "spectrum" is not a valid color name/);
  assert.equal(f.loads(), 0);
});

test('a failed state cell (e.g. a 404 download) fails the render instead of reporting success', async () => {
  const f = fakeMolstar({
    cells: [
      { status: 'ok', id: 'ms-plugin.root' },
      { status: 'error', id: 'ms-plugin.download', errorText: 'Download failed with status code 404' },
      { status: 'pending', id: 'ms-plugin.parse-cif' },
    ],
  });
  await assert.rejects(createUmdRenderer(f.molstar, f.viewer).loadMvsj(MVSJ), /download: Download failed with status code 404/);
});

test('a bundle without validationIssues or a state map still works', async () => {
  const molstar: MolstarUmd = { PluginExtensions: { mvs: { MVSData: { fromMVSJ: (t) => JSON.parse(t) }, loadMVS: async () => {} } } };
  await createUmdRenderer(molstar, { plugin: {} }).loadMvsj(MVSJ);
});
