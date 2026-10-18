import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Db } from "@paperclipai/db";
import { assertAllowedModel, modelPolicyService } from "../ppclip/providers/model-policy.js";
import { setPpclipFeaturesFileForTests, writePpclipFeatures } from "../ppclip/features.js";
const policy = { allowedModels: [{ adapterType: "codex_local", model: "gpt-5.4-mini" }] };
describe("runtime model approval", () => {
  it("bypasses policy reads when off and enforces again immediately when enabled", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ppclip-model-switch-"));
    setPpclipFeaturesFileForTests(path.join(dir, "features.json"));
    const select = vi.fn(() => { throw new Error("policy read reached"); });
    const service = modelPolicyService({ select } as unknown as Db);
    try {
      writePpclipFeatures({ modelApprovals: false });
      await expect(service.assertAllowed("company", "codex_local", {})).resolves.toBeUndefined();
      await service.initializeExisting();
      expect(select).not.toHaveBeenCalled();
      writePpclipFeatures({ modelApprovals: true });
      await expect(service.assertAllowed("company", "codex_local", {})).rejects.toThrow("policy read reached");
    } finally { setPpclipFeaturesFileForTests(null); fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it.each([undefined, "", " ", "default", "auto"])("refuses implicit model %s", model => {
    expect(() => assertAllowedModel(policy, "codex_local", { model })).toThrow(/explicit model/);
  });
  it("checks exact model and harness after resolving a runner", () => {
    expect(() => assertAllowedModel(policy, "paperclip_runner", { provider: "codex", model: "gpt-5.4-mini" })).not.toThrow();
    expect(() => assertAllowedModel(policy, "codex_local", { model: "gpt-6-astra" })).toThrow(/not approved/);
    expect(() => assertAllowedModel(policy, "claude_local", { model: "gpt-5.4-mini" })).toThrow(/not approved/);
    expect(() => assertAllowedModel({ allowedModels: [] }, "codex_local", { model: "gpt-5.4-mini" })).toThrow(/not approved/);
  });
  it.each([["--model", "gpt-6-astra"], ["--model=gpt-6-astra"], ["-mgpt-6-astra"], ["-cmodel=\"gpt-6-astra\""], ["-c", "model=\"gpt-6-astra\""]])("refuses model overrides in extra arguments %s", (...extraArgs) => {
    expect(() => assertAllowedModel(policy, "codex_local", { model: "gpt-5.4-mini", extraArgs })).toThrow(/extra arguments/);
  });
  it("does not impose a model on non-model runtimes", () => {
    expect(() => assertAllowedModel(policy, "process", {})).not.toThrow();
    expect(() => assertAllowedModel(policy, "paperclip_runner", { provider: "openai_dot" })).not.toThrow();
  });
  it("uses the same approvals for direct and ACP Claude runners", () => {
    const claude = { allowedModels: [{ adapterType: "claude_local", model: "claude-haiku-4-5" }] };
    expect(() => assertAllowedModel(claude, "paperclip_runner", { provider: "claude", model: "claude-haiku-4-5" })).not.toThrow();
    expect(() => assertAllowedModel(claude, "paperclip_runner", { provider: "acpx", acpxAgent: "claude", model: "claude-haiku-4-5" })).not.toThrow();
  });
});
