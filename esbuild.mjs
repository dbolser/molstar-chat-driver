// Build script for molstar-chat-driver.
//   node esbuild.mjs build   -> bundles the library to dist/index.js (ESM)
//   node esbuild.mjs demo    -> serves the playable demo at http://localhost:8765
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
  // Start the chat backend (keyword mode, or LLM mode if .env has a key).
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
} else {
  console.error(`unknown mode: ${mode} (use "build" or "demo")`);
  process.exit(1);
}
