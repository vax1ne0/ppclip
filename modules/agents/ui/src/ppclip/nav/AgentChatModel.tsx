import type { Agent } from "@paperclipai/shared";
import { getAdapterDisplay } from "@/adapters/adapter-display-registry";
import { configuredModel } from "@/ppclip/agent-model";
import { usePpclipFeature } from "@/ppclip/features/store";
import { ProviderMark } from "@/ppclip/providers/ProviderMark";

/** Configured model, rather than an inference from the last conversation. */
export function AgentChatModel({ agent }: { agent: Pick<Agent, "adapterType" | "adapterConfig"> }) {
  const enabled = usePpclipFeature("rosterExtras");
  if (!enabled) return null;
  const model = configuredModel(agent.adapterConfig);
  const adapter = getAdapterDisplay(agent.adapterType ?? "unknown");
  const provider = agent.adapterType === "codex_local" || agent.adapterType === "paperclip_runner" ? "openai"
    : agent.adapterType === "claude_local" ? "anthropic"
    : agent.adapterType === "grok_local" ? "xai" : null;
  const Icon = adapter.icon;
  const description = `${adapter.label} · ${model ? `Configured model: ${model}` : "No explicit model configured. Choose a model in agent settings."}`;
  return <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" title={description} aria-label={description} data-testid="ppclip-chat-model">
    {provider === "openai" ? <span className="flex size-4 shrink-0" aria-hidden>
      <img src="/brands/apps/openai.svg" alt="" className="size-4 dark:hidden" />
      <img src="/brands/apps/openai-dark.svg" alt="" className="hidden size-4 dark:block" />
    </span> : provider ? <ProviderMark provider={provider} /> : <Icon className="size-4 shrink-0" aria-hidden />}
    <span className="truncate">{model ?? "Model not set"}</span>
  </span>;
}
