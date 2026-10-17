import { useSyncExternalStore } from "react";
import { api } from "@/api/client";
import { defaultPpclipFeatures, type PpclipFeatureKey, type PpclipFeatures } from "./registry";
import { writePpclipFlags } from "./flags";

/**
 * ppclip module switches for the whole UI. Loaded once from the server and
 * shared by React components (usePpclipFeature) and plain functions
 * (ppclipFeatureEnabled). Until the server answers, every module counts as on,
 * matching the server default, so a normal load never flickers.
 */
export const ppclipFeaturesApi = {
  get: () => api.get<PpclipFeatures>("/ppclip/features"),
  update: (patch: Partial<PpclipFeatures>) => api.patch<PpclipFeatures>("/ppclip/features", patch),
};

let current: PpclipFeatures = defaultPpclipFeatures();
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setPpclipFeatures(next: PpclipFeatures) {
  current = { ...defaultPpclipFeatures(), ...next };
  writePpclipFlags(current);
  emit();
}

function ensureLoaded() {
  loading ??= ppclipFeaturesApi.get().then(setPpclipFeatures, () => {
    // Unreachable or not signed in yet: keep the defaults and try again on the next subscriber.
    loading = null;
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  ensureLoaded();
  return () => listeners.delete(listener);
}

export function ppclipFeatureEnabled(key: PpclipFeatureKey) {
  return current[key];
}

export function usePpclipFeatures(): PpclipFeatures {
  return useSyncExternalStore(subscribe, () => current, () => current);
}

export function usePpclipFeature(key: PpclipFeatureKey) {
  return usePpclipFeatures()[key];
}

/** Tests reset the store between cases. */
export function resetPpclipFeaturesForTests(next: Partial<PpclipFeatures> = {}) {
  current = { ...defaultPpclipFeatures(), ...next };
  writePpclipFlags(current);
  loading = Promise.resolve();
  emit();
}
