import fs from "node:fs";
import path from "node:path";
import { resolvePaperclipInstanceRoot } from "../home-paths.js";

/**
 * ppclip module switches. Instance-wide (like official's Experimental
 * settings), every module on by default, stored in a small JSON file in the
 * instance folder so ppclip needs no database migration. Keep the keys in step
 * with ui/src/ppclip/features/registry.ts.
 */
export const PPCLIP_FEATURE_KEYS = [
  "team",
  "liveRuns",
  "providerUsage",
  "providerRouting",
  "runControls",
  "computerUse",
  "urgencyOrder",
  "attention",
  "rosterExtras",
  "taskChatRuns",
  "staleRunningRepair",
  "liveRefresh",
  "deletedCommentReply",
  "windowsSignIn",
] as const;
export type PpclipFeatureKey = (typeof PPCLIP_FEATURE_KEYS)[number];
export type PpclipFeatures = Record<PpclipFeatureKey, boolean>;

const FILE_NAME = "ppclip-features.json";

export function defaultPpclipFeatures(): PpclipFeatures {
  return Object.fromEntries(PPCLIP_FEATURE_KEYS.map((key) => [key, true])) as PpclipFeatures;
}

let filePathOverride: string | null = null;
/** Tests point the store at a temporary file. */
export function setPpclipFeaturesFileForTests(file: string | null) {
  filePathOverride = file;
  cache = null;
}
function featuresFile() {
  return filePathOverride ?? path.join(resolvePaperclipInstanceRoot(), FILE_NAME);
}

let cache: PpclipFeatures | null = null;

/** Missing or unreadable file, or unknown keys, fall back to the defaults (everything on). */
function load(): PpclipFeatures {
  const features = defaultPpclipFeatures();
  try {
    const stored = JSON.parse(fs.readFileSync(featuresFile(), "utf8")) as Record<string, unknown>;
    for (const key of PPCLIP_FEATURE_KEYS) if (typeof stored[key] === "boolean") features[key] = stored[key] as boolean;
  } catch {
    // Not written yet: every module stays on.
  }
  return features;
}

export function readPpclipFeatures(): PpclipFeatures {
  cache ??= load();
  return { ...cache };
}

/** Synchronous check for hot paths (scheduler, run queries). */
export function ppclipFeature(key: PpclipFeatureKey): boolean {
  cache ??= load();
  return cache[key];
}

export function writePpclipFeatures(patch: Partial<PpclipFeatures>): PpclipFeatures {
  const next = { ...readPpclipFeatures(), ...patch };
  const file = featuresFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(next, null, 2) + "\n");
  fs.renameSync(temp, file);
  cache = next;
  return { ...next };
}

/** Express gate for a module's own routes: a switched-off module answers 404. */
export function ppclipFeatureGate(key: PpclipFeatureKey) {
  return (_req: unknown, res: { status(code: number): { json(body: unknown): void } }, next: () => void) => {
    if (ppclipFeature(key)) return next();
    res.status(404).json({ error: "This ppclip module is turned off in Settings → ppclip." });
  };
}
