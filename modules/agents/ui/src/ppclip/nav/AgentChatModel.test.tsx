// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@paperclipai/shared";
import { AgentChatModel } from "./AgentChatModel";
const state = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/ppclip/features/store", () => ({ usePpclipFeature: () => state.enabled }));
const agent = (adapterType: Agent["adapterType"], model?: string) => ({ adapterType, adapterConfig: { model } });

describe("chat sidebar model", () => {
  it("shows the configured model and theme-aware OpenAI logo", () => {
    const html = renderToStaticMarkup(<AgentChatModel agent={agent("codex_local", "  gpt-5.4  ")} />);
    expect(html).toContain("Configured model: gpt-5.4");
    expect(html).toContain("/brands/apps/openai-dark.svg");
    expect(html).toContain("dark:hidden");
  });
  it("identifies defaults honestly and supports unfamiliar adapters", () => {
    const html = renderToStaticMarkup(<AgentChatModel agent={agent("custom_gateway")} />);
    expect(html).toContain("No explicit model configured. Choose a model in agent settings.");
    expect(html).toContain("Model not set");
    expect(html).not.toContain("/brands/apps/openai");
    expect(renderToStaticMarkup(<AgentChatModel agent={agent("claude_local", "claude-opus-4-6")} />)).toContain("/brands/claude-color.svg");
  });
  it("respects the Agents page extras module switch", () => {
    state.enabled = false;
    try { expect(renderToStaticMarkup(<AgentChatModel agent={agent("codex_local")} />)).toBe(""); }
    finally { state.enabled = true; }
  });
});
