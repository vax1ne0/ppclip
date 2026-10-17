/**
 * ppclip CHAT-4: decide whether a settled run turn belongs to the agent that
 * wrote a reply bubble. Official compared display names only and treated a
 * missing name as a match, so one agent's activity could attach under another
 * agent's reply. Agent ids win; names are only a fallback when an id is absent,
 * and a missing name never counts as a match.
 *
 * Kept dependency-free so the official transcript adapter can import it without
 * an import cycle.
 */
import { readPpclipFlag } from "./features/flags";

export function isSameRunAgent(
  turn: { agentKey?: string | null; agentName?: string | null } | null | undefined,
  bubble: { agent?: { id?: string | null } | null; authorName?: string | null },
): boolean {
  if (!turn) return false;
  // Module off (Settings → ppclip → Task chat): official's name-only check.
  if (!readPpclipFlag("taskChatRuns")) {
    return turn.agentName == null || bubble.authorName == null || turn.agentName === bubble.authorName;
  }
  const turnAgentId = turn.agentKey || null;
  const bubbleAgentId = bubble.agent?.id || null;
  if (turnAgentId && bubbleAgentId) return turnAgentId === bubbleAgentId;
  const turnName = turn.agentName?.trim();
  const bubbleName = bubble.authorName?.trim();
  return Boolean(turnName && bubbleName && turnName === bubbleName);
}
