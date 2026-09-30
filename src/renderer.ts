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

/** A Mol* state cell, as far as we read it: did its transform succeed, and if not, why. */
interface StateCellLike {
  status: string;
  errorText?: unknown;
  transform?: { transformer?: { id?: string } };
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
      // `loadMVS` resolves even when a step inside the scene failed (a 404 on the download URL
      // leaves the download cell at status "error" and everything below it pending) — which
      // would report "rendered" over an empty viewer. Surface the first failed cell instead.
      const failed = failedCells(viewer.plugin);
      if (failed.length) throw new Error(failed.join('; '));
    },
  };
}

/** Error text of every state cell that failed, e.g. `download: Download failed with status code 404`. */
function failedCells(plugin: unknown): string[] {
  const cells = (plugin as { state?: { data?: { cells?: Map<string, StateCellLike> } } })?.state?.data?.cells;
  if (!cells || typeof cells.values !== 'function') return []; // Mol* internals may change shape
  const out: string[] = [];
  for (const cell of cells.values()) {
    if (cell.status !== 'error') continue;
    const step = cell.transform?.transformer?.id?.split('.').pop() ?? 'step';
    out.push(`${step}: ${String(cell.errorText ?? 'failed')}`);
  }
  return out;
}
