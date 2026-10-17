/** The id of an agent's card on the Live runs page, so other pages can link straight to it. */
export function liveAgentAnchor(agentId: string) {
  return `live-agent-${agentId}`;
}

export function liveAgentHref(agentId: string) {
  return `/dashboard/live#${liveAgentAnchor(agentId)}`;
}
