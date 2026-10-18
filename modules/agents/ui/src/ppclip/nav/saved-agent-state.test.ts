import { QueryClient } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import { expect, it } from "vitest";
import { publishSavedAgent } from "./saved-agent-state";

it("publishes confirmed roles into company lists and detail aliases without waiting on a refetch", () => {
  const client = new QueryClient();
  const before = { id: "one", companyId: "company", urlKey: "before", role: "general" } as Agent;
  const other = { ...before, id: "two" };
  client.setQueryData(["agents", "company"], [before, other]);
  client.setQueryData(["agents", "other-company"], [other]);
  client.setQueryData(["agents", "detail", "before", "company"], { ...before, extra: "keep" });
  const updated = { ...before, role: "designer", urlKey: "after" } as Agent;
  publishSavedAgent(client, updated);
  expect(client.getQueryData<Agent[]>(["agents", "company"])?.map(agent => agent.role)).toEqual(["designer", "general"]);
  expect(client.getQueryData(["agents", "other-company"])).toEqual([other]);
  expect(client.getQueryData(["agents", "detail", "before", "company"])).toMatchObject({ role: "designer", extra: "keep" });
  expect(client.getQueryData(["agents", "detail", "after", "company"])).toMatchObject({ role: "designer", extra: "keep" });
  client.clear();
});
