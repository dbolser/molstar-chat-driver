// Build script for molstar-chat-driver.
//   node esbuild.mjs build       -> bundles the library to dist/index.js (ESM)
//   node esbuild.mjs demo        -> serves the playable demo + keyword backend at :8765/:8787
//   node esbuild.mjs build-demo  -> bundles the demo page only (serve it yourself, any backend)
import * as esbuild from 'esbuild';

const mode = process.argv[2] ?? 'build';

const shared = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info',
};

if (mode === 'build') {
  // Mol* is a peer dependency provided by the host (UMD global or its own bundle), so it is
  // marked external and never pulled into our output.
  await esbuild.build({
    ...shared,
    entryPoints: ['src/index.ts'],
    outfile: 'dist/index.js',
    external: ['molstar', 'molstar/*'],
  });
  console.log('✓ built dist/index.js');
} else if (mode === 'demo') {
  // Start the keyword-only dev backend, then serve + watch the demo page.
  const { startChatServer } = await import('./demo/server.mjs');
  startChatServer();

  const ctx = await esbuild.context({
    ...shared,
    entryPoints: ['demo/demo.ts'],
    outfile: 'demo/dist/demo.js',
  });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'demo', port: 8765 });
  console.log(`\n  demo running →  http://localhost:${port}/\n`);
} else if (mode === 'build-demo') {
  // Bundle the demo page only (no server, no watch) so it can be served statically against
  // ANY backend — e.g. the MolBench-powered one. See README → Run a local "production" setup.
  await esbuild.build({
    ...shared,
    entryPoints: ['demo/demo.ts'],
    outfile: 'demo/dist/demo.js',
  });
  console.log('✓ built demo/dist/demo.js');
} else if (mode === 'build-site') {
  // Bundle the evaluator preview site (site/ → site/dist/site.js). Deployed to GitHub Pages;
  // talks to the Supabase Edge Functions. See site/ and SETUP.md.
  await esbuild.build({
    ...shared,
    entryPoints: ['site/main.ts'],
    outfile: 'site/dist/site.js',
  });
  console.log('✓ built site/dist/site.js');
} else {
  console.error(`unknown mode: ${mode} (use "build", "demo", "build-demo", or "build-site")`);
  process.exit(1);
}
