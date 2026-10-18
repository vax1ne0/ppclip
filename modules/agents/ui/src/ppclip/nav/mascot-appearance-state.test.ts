import { QueryClient } from "@tanstack/react-query";
import { appearanceForPalette, type Agent } from "@paperclipai/shared";
import { expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { publishMascotAppearance, randomMascotColors } from "./mascot-appearance-state";

it("publishes saved colors into sidebar, detail aliases and identities without overwriting other fields or agents", () => {
  const client = new QueryClient();
  const agent = { id: "fathy-id", companyId: "company", name: "Fathy", appearance: appearanceForPalette("arctic-blue"), title: "Keep this" } as Agent;
  const other = { ...agent, id: "other" };
  client.setQueryData(queryKeys.agents.list(agent.companyId), [agent, other]);
  client.setQueryData([...queryKeys.agents.detail("fathy"), agent.companyId], agent);
  client.setQueryData(queryKeys.agents.identity(agent.id), agent);
  const appearance = { ...agent.appearance!, customColors: { a: "#123456", b: "#abcdef" } };
  publishMascotAppearance(client, agent, appearance);
  expect(client.getQueryData<Agent[]>(queryKeys.agents.list(agent.companyId))?.[0]).toMatchObject({ appearance, title: "Keep this" });
  expect(client.getQueryData<Agent[]>(queryKeys.agents.list(agent.companyId))?.[1]).toEqual(other);
  expect(client.getQueryData<Agent>([...queryKeys.agents.detail("fathy"), agent.companyId])?.appearance).toEqual(appearance);
  expect(client.getQueryData<Agent>(queryKeys.agents.identity(agent.id))?.appearance).toEqual(appearance);
  client.clear();
});
it("generates two independent 24-bit hex colors rather than selecting a preset", () => {
  const rng = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((target: any) => { target.set([0x12, 0x34, 0x56, 0xab, 0xcd, 0xef]); return target; });
  try { expect(randomMascotColors()).toEqual({ a: "#123456", b: "#abcdef" }); }
  finally { rng.mockRestore(); }
});
