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
      MVSData: {
        fromMVSJ(text: string): unknown;
        /** Human-readable validation problems, or undefined when the tree is valid. */
        validationIssues?(data: unknown): string[] | undefined;
      };
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
 * `sanityChecks: true` makes Mol* validate the scene tree before rendering, so an invalid scene
 * surfaces as a clean rejection rather than a broken view.
 */
export function createUmdRenderer(molstar: MolstarUmd, viewer: MolstarViewerLike): MvsRenderer {
  return {
    async loadMvsj(mvsj: string): Promise<void> {
      const { MVSData, loadMVS } = molstar.PluginExtensions.mvs;
      const data = MVSData.fromMVSJ(mvsj);
      // Mol* logs *why* a tree is invalid to the console but throws a bare "FormatError". Ask it
      // first, so the user (and the capture) sees e.g. `"spectrum" is not a valid color name`.
      const issues = MVSData.validationIssues?.(data);
      if (issues?.length) throw new Error(`Invalid scene: ${issues.map((s) => s.replace(/\s+/g, ' ').trim()).join(' ')}`);
      await loadMVS(viewer.plugin, data, { sanityChecks: true });
    },
  };
}
