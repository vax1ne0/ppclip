import type { QueryClient } from "@tanstack/react-query";
import { agentAvatarUrl, type Agent, type AgentAppearance } from "@paperclipai/shared";
import { queryKeys } from "@/lib/queryKeys";

/** Publish the server-confirmed appearance before background refetches finish. */
export function publishMascotAppearance(client: QueryClient, agent: Pick<Agent, "id" | "companyId" | "appearance">, appearance: AgentAppearance) {
  const patch = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    return record.id === agent.id ? { ...record, appearance, avatarUrl: agentAvatarUrl(appearance) } : value;
  };
  client.setQueryData(queryKeys.agents.list(agent.companyId), (previous: Agent[] | undefined) => previous?.map(item => patch(item) as Agent));
  client.setQueriesData({ queryKey: ["agents", "detail"] }, patch);
  client.setQueriesData({ queryKey: ["agents", "identity"] }, patch);
}

/** Full 24-bit custom colors; only called for an explicit Surprise me action. */
export function randomMascotColors() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  const hex = (start: number) => `#${[...bytes.slice(start, start + 3)].map(value => value.toString(16).padStart(2, "0")).join("")}`;
  return { a: hex(0), b: hex(3) };
}
