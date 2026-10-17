import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PPCLIP_FEATURE_KEYS,
  ppclipFeature,
  ppclipFeatureGate,
  readPpclipFeatures,
  setPpclipFeaturesFileForTests,
  writePpclipFeatures,
} from "../ppclip/features.js";
import { ppclipRunCreditForDay } from "../ppclip/run-controls/credit.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ppclip-features-"));
  file = path.join(dir, "ppclip-features.json");
  setPpclipFeaturesFileForTests(file);
});

afterEach(() => {
  setPpclipFeaturesFileForTests(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("ppclip module switches", () => {
  it("turns every module on until something is saved", () => {
    expect(fs.existsSync(file)).toBe(false);
    const features = readPpclipFeatures();
    expect(Object.keys(features).sort()).toEqual([...PPCLIP_FEATURE_KEYS].sort());
    expect(Object.values(features).every(Boolean)).toBe(true);
  });

  it("saves a change, keeps the rest, and survives a reload", () => {
    writePpclipFeatures({ team: false });
    expect(ppclipFeature("team")).toBe(false);
    expect(ppclipFeature("liveRuns")).toBe(true);
    setPpclipFeaturesFileForTests(file); // drops the cache, as a restart would
    expect(ppclipFeature("team")).toBe(false);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).team).toBe(false);
  });

  it("falls back to everything on for an unreadable file and ignores unknown keys", () => {
    fs.writeFileSync(file, "{ not json");
    expect(readPpclipFeatures().team).toBe(true);
    fs.writeFileSync(file, JSON.stringify({ team: false, somethingElse: false, liveRuns: "no" }));
    setPpclipFeaturesFileForTests(file);
    const features = readPpclipFeatures();
    expect(features.team).toBe(false);
    expect(features.liveRuns).toBe(true);
    expect("somethingElse" in features).toBe(false);
  });

  it("answers 404 on a switched-off module's routes and passes through otherwise", () => {
    const gate = ppclipFeatureGate("runControls");
    const res = { code: 0, body: null as unknown, status(code: number) { this.code = code; return { json: (body: unknown) => { this.body = body; } }; } };
    let passed = 0;
    gate({}, res, () => { passed += 1; });
    expect(passed).toBe(1);
    writePpclipFeatures({ runControls: false });
    gate({}, res, () => { passed += 1; });
    expect(passed).toBe(1);
    expect(res.code).toBe(404);
  });

  it("stops crediting Unlimited runs when Run controls is off", () => {
    const day = new Date("2026-10-17T00:00:00.000Z");
    const metadata = { ppclipRunControls: { unlimited: true, credit: { day: "2026-10-17", runs: 3 } } };
    writePpclipFeatures({ runControls: false });
    expect(ppclipRunCreditForDay(metadata, day)).toBe(0);
  });
});
