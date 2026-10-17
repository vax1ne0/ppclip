import { agentUrl } from "@/lib/utils";

/** The agent's big-screen computer page, inside the agent page (it keeps the agent's sidebar). */
export function agentComputerHref(agent: { id: string; urlKey?: string | null; name?: string | null }) {
  return `${agentUrl(agent)}/computer`;
}

/** Same, from a route reference (url key or id) such as the agent sidebar receives. */
export function agentComputerHrefFromRef(agentRef: string) {
  return `/agents/${agentRef}/computer`;
}
