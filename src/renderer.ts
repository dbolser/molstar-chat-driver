/**
 * MvsRenderer implementations.
 *
 * A renderer turns MVSJ text into a molecular view. We provide an adapter for the Mol* UMD
 * viewer bundle (`window.molstar`), which is the zero-config way to get Mol* into a page.
 * Consumers embedding Mol* as an ES library can implement {@link MvsRenderer} themselves with
 * `loadMVS` from `molstar/lib/extensions/mvs/load` — see README.
 */
import { MvsRenderer } from './types';

/**
 * Minimal shape of the bits we use from the Mol* UMD viewer bundle (`window.molstar`).
 *
 * Declared locally + loosely on purpose: this keeps the package free of any build-time
 * dependency on the (large) `molstar` package. The real types live in `molstar`; we only need
 * structural access to two functions here.
 */
export interface MolstarUmd {
  PluginExtensions: {
    mvs: {
      MVSData: { fromMVSJ(text: string): unknown };
      loadMVS(plugin: unknown, data: unknown, options?: Record<string, unknown>): Promise<void>;
    };
  };
}

/** The bit of a Mol* `Viewer` instance we need: its underlying plugin context. */
export interface MolstarViewerLike {
  plugin: unknown;
}

/**
 * Build an {@link MvsRenderer} backed by a Mol* UMD `Viewer` instance.
 *
 * `sanityChecks: true` makes Mol* validate the scene tree before rendering — a second safety
 * net behind the endpoint's Tier-0 parse check. A model can emit valid JSON that is still
 * invalid MVS; this catches that before it reaches an evaluator's eyes.
 */
export function createUmdRenderer(molstar: MolstarUmd, viewer: MolstarViewerLike): MvsRenderer {
  return {
    async loadMvsj(mvsj: string): Promise<void> {
      const data = molstar.PluginExtensions.mvs.MVSData.fromMVSJ(mvsj);
      await molstar.PluginExtensions.mvs.loadMVS(viewer.plugin, data, { sanityChecks: true });
    },
  };
}
