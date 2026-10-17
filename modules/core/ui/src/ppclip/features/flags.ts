/**
 * Current ppclip module switches, dependency-free so low-level helpers (for
 * example the transcript adapter's same-agent check) can read them without an
 * import cycle. The store in ./store.ts keeps this up to date.
 */
import type { PpclipFeatureKey } from "./registry";

let flags: Partial<Record<PpclipFeatureKey, boolean>> = {};

export function readPpclipFlag(key: PpclipFeatureKey) {
  return flags[key] !== false;
}

export function writePpclipFlags(next: Partial<Record<PpclipFeatureKey, boolean>>) {
  flags = next;
}
