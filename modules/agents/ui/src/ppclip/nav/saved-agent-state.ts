import type { QueryClient } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import { queryKeys } from "@/lib/queryKeys";

/** Apply a confirmed save immediately; background refreshes must not gate the form. */
export function publishSavedAgent(client: QueryClient, updated: Agent) {
  const matches = (value: unknown): value is Agent => Boolean(value && typeof value === "object" &&
    (value as Agent).id === updated.id && (value as Agent).companyId === updated.companyId);
  client.setQueryData(queryKeys.agents.list(updated.companyId), (previous: Agent[] | undefined) =>
    previous?.map(agent => matches(agent) ? { ...agent, ...updated } : agent));
  for (const [key, previous] of client.getQueriesData({ queryKey: ["agents", "detail"] })) {
    if (!matches(previous)) continue;
    const saved = { ...previous, ...updated };
    client.setQueryData(key, saved);
    // Seed the renamed route with the same company suffix before navigation.
    if (updated.urlKey && previous.urlKey && key[2] === previous.urlKey && previous.urlKey !== updated.urlKey) {
      client.setQueryData([...key.slice(0, 2), updated.urlKey, ...key.slice(3)], saved);
    }
  }
}
