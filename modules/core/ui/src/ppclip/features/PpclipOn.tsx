import type { ReactNode } from "react";
import type { PpclipFeatureKey } from "./registry";
import { usePpclipFeature } from "./store";

/** Renders its children only while the ppclip module is on (Settings → ppclip); otherwise the fallback. */
export function PpclipOn({ feature, children, fallback = null }: { feature: PpclipFeatureKey; children: ReactNode; fallback?: ReactNode }) {
  return <>{usePpclipFeature(feature) ? children : fallback}</>;
}
