import type { CharacterState } from "@paperclipai/shared";
import type { TranscriptEntry } from "@/adapters";

/**
 * ppclip DASH-2: what a running agent is doing right now, in plain words,
 * derived from the tail of its live transcript (ported from the old fork's
 * `currentRunActivity`, now with a kind so the card can pick an avatar pose).
 */
type ActivityKind =
  | "reading"
  | "writing"
  | "searching"
  | "command"
  | "tool"
  | "waiting"
  | "thinking"
  | "responding"
  | "working";

type LiveActivity = { kind: ActivityKind; label: string };

const humanize = (name: string) =>
  name
    .replace(/^mcp__[^_]+__/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();

/** A tool name in plain words: Reading / Writing / Searching / Running command / Using X. */
export function toolActivity(name: string): LiveActivity {
  const lower = name.toLowerCase();
  if (/todo|plan/.test(lower)) return { kind: "thinking", label: "Planning" };
  if (/search|grep|glob|find/.test(lower)) return { kind: "searching", label: "Searching" };
  if (/write|edit|patch|create_file|str_replace/.test(lower)) return { kind: "writing", label: "Writing" };
  if (/read|open|view|fetch|cat\b|list|ls\b/.test(lower)) return { kind: "reading", label: "Reading" };
  if (/exec|shell|bash|command|terminal|run/.test(lower)) return { kind: "command", label: "Running command" };
  const readable = humanize(name);
  return { kind: "tool", label: readable ? `Using ${readable}` : "Using a tool" };
}

const PENDING_REQUEST: LiveActivity = { kind: "waiting", label: "Waiting for approval" };
const RESPONDING: LiveActivity = { kind: "responding", label: "Responding" };
const THINKING: LiveActivity = { kind: "thinking", label: "Thinking" };
const WORKING: LiveActivity = { kind: "working", label: "Working" };

/**
 * Walking back from the newest entry: a pending runtime request means the run
 * waits on a person; an unfinished tool call (no matching result yet, so
 * parallel calls still count) names the tool; the latest assistant / thinking
 * entry says Responding / Thinking; only finished tools means Thinking.
 * Returns null when the transcript says nothing yet.
 */
export function currentRunActivity(entries: readonly TranscriptEntry[]): LiveActivity | null {
  const resolvedRequests = new Set<string>();
  const finishedCalls = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "tool_result") finishedCalls.add(entry.toolUseId);
    if (entry.kind === "runtime_request" && entry.status !== "pending") resolvedRequests.add(entry.requestId);
  }
  let sawResult = false;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind === "runtime_request" && entry.status === "pending" && !resolvedRequests.has(entry.requestId)) {
      return PENDING_REQUEST;
    }
    if (entry.kind === "tool_call") {
      if (entry.toolUseId && finishedCalls.has(entry.toolUseId)) continue;
      return toolActivity(entry.name);
    }
    // A newer message means earlier tool calls are over, even without results.
    if (entry.kind === "assistant") return RESPONDING;
    if (entry.kind === "thinking") return THINKING;
    if (entry.kind === "tool_result") sawResult = true;
  }
  return sawResult ? THINKING : null;
}

/**
 * Fallback from the official live-runs row (`currentToolName` /
 * `lastAssistantSnippet` come from the server's run progress tracker), used
 * before the transcript loads or for runs beyond the transcript budget.
 */
function activityFromRunProgress(run: {
  currentToolName?: string | null;
  lastAssistantSnippet?: string | null;
}): LiveActivity | null {
  if (run.currentToolName) return toolActivity(run.currentToolName);
  if (run.lastAssistantSnippet) return RESPONDING;
  return null;
}

/** Activity for a running card: transcript first, then the server's progress, then "Working". */
export function resolveLiveActivity(
  entries: readonly TranscriptEntry[],
  run: { currentToolName?: string | null; lastAssistantSnippet?: string | null },
): LiveActivity {
  return currentRunActivity(entries) ?? activityFromRunProgress(run) ?? WORKING;
}

/** Official avatar pose for an activity (the static pose image, no extra animation player). */
export function poseForActivity(kind: ActivityKind): CharacterState {
  if (kind === "thinking") return "thinking";
  if (kind === "waiting") return "listening";
  return "working";
}
