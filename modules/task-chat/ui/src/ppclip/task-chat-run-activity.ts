import type { IssueChatComment } from "@/lib/issue-chat-messages";
import type {
  TaskChatItem,
  TaskChatMarkerItem,
  TaskChatTurnItem,
} from "@/components/task-chat/task-chat-model";
import {
  attachSettledTurns,
  type SettledTurnMergeMeta,
} from "@/components/task-chat/transcript-adapter";

/**
 * ppclip CHAT-3: a task chat shows a run's activity (thinking, tools, Worked
 * row, run status) only when the run was started for this task.
 *
 * Official "runs for this issue" also returns runs that merely wrote to the
 * issue while executing another task (contextIssueId = that other task). Their
 * comments still appear here; their transcript belongs to the other task.
 * Runs with no task context at all (Agent Chat, timer/heartbeat runs) stay
 * visible: they did act here and have no other task chat to show up in.
 */
export function isRunForThisTask(
  run: { contextIssueId?: string | null },
  issueId: string | null | undefined,
): boolean {
  if (!issueId) return true;
  const contextIssueId = run.contextIssueId;
  return !contextIssueId || contextIssueId === issueId;
}

/** Filters linked runs for this task chat, keeping the input reference when nothing is dropped. */
export function runsForThisTask<T extends { contextIssueId?: string | null }>(
  runs: T[] | undefined,
  issueId: string | null | undefined,
): T[] | undefined {
  if (!runs || !issueId) return runs;
  if (runs.every((run) => isRunForThisTask(run, issueId))) return runs;
  return runs.filter((run) => isRunForThisTask(run, issueId));
}

type RunReplyComment = Pick<
  IssueChatComment,
  | "id"
  | "createdAt"
  | "deletedAt"
  | "authorType"
  | "runId"
  | "createdByRunId"
  | "derivedCreatedByRunId"
  | "steeredIntoRunId"
  | "conversationAnchorAt"
>;

/**
 * The run that wrote a comment. Stored provenance first (as the official
 * task-chat adapter does), then the activity-derived run id, then recovered
 * attribution for replies posted through the API.
 */
export function commentRunId(comment: RunReplyComment): string | null {
  return (
    comment.createdByRunId ??
    comment.runId ??
    comment.derivedCreatedByRunId ??
    null
  );
}

function toMs(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * ppclip CHAT-4 anchoring: each run's activity anchors to the run's FIRST reply
 * (by creation time), not the last. The Worked row is shown above the answer,
 * so the first reply is where the run's visible output starts; anchoring to the
 * last reply split a multi-reply run around its own activity. Recovered run
 * links (createdByRunId / derivedCreatedByRunId) count, so API-posted replies
 * get their activity too. System notices never own a run's activity. As in
 * official, a run steered mid-turn stays unanchored so its segments interleave
 * around the injected human message.
 */
export function firstReplyCommentIdByRun(
  comments: readonly RunReplyComment[],
): Map<string, string> {
  const map = new Map<string, string>();
  const ordered = comments
    .map((comment, index) => ({ comment, index }))
    .sort(
      (a, b) =>
        toMs(a.comment.createdAt) - toMs(b.comment.createdAt) ||
        a.index - b.index,
    );
  for (const { comment } of ordered) {
    if (comment.deletedAt || !comment.id || comment.authorType === "system")
      continue;
    const runId = commentRunId(comment);
    if (!runId || map.has(runId)) continue;
    map.set(runId, comment.id);
  }
  for (const comment of comments) {
    const runId = comment.steeredIntoRunId;
    if (!comment.deletedAt && runId && comment.conversationAnchorAt) {
      map.delete(runId);
    }
  }
  return map;
}

/** Run id of a settled turn item (`<runId>:turn` or `<runId>:turn:<segment>`). */
export function turnRunId(turnId: string): string {
  return turnId.replace(/:turn(?::\d+)?$/, "");
}

const FOLLOW_UP_RUN_LABEL = "Follow-up run";
const FOLLOW_UP_RUN_DETAIL = "A separate execution by this agent";

/**
 * Owner choice: classic (non-runner) activity anchored to a run's reply moves
 * directly BELOW that run's last reply in the thread, so the answer reads
 * first and the "Worked" row follows it as its own row (the reply keeps its
 * timestamp/actions footer). A run that posted several replies keeps them
 * together, with its activity after the last one.
 */
export function placeTurnsBelowReplies(
  items: readonly TaskChatItem[],
  replyIdByTurnId: ReadonlyMap<string, string>,
  runIdByCommentId: ReadonlyMap<string, string>,
): TaskChatItem[] {
  if (replyIdByTurnId.size === 0) return [...items];
  const presentIds = new Set(items.map((item) => item.id));
  // The last reply of each run, in thread order.
  const lastReplyIdByRun = new Map<string, string>();
  for (const item of items) {
    if (item.kind === "turn") continue;
    const runId = runIdByCommentId.get(item.id);
    if (runId) lastReplyIdByRun.set(runId, item.id);
  }
  const movedByReply = new Map<string, TaskChatItem[]>();
  const rest: TaskChatItem[] = [];
  for (const item of items) {
    const anchorId =
      item.kind === "turn" ? replyIdByTurnId.get(item.id) : undefined;
    const runId = anchorId ? runIdByCommentId.get(anchorId) : undefined;
    const target = (runId && lastReplyIdByRun.get(runId)) ?? anchorId;
    if (target && presentIds.has(target)) {
      const list = movedByReply.get(target) ?? [];
      list.push(item);
      movedByReply.set(target, list);
      continue;
    }
    rest.push(item);
  }
  const out: TaskChatItem[] = [];
  for (const item of rest) {
    out.push(item);
    const moved = movedByReply.get(item.id);
    if (moved) out.push(...moved);
  }
  return out;
}

/**
 * Separate runs of the same agent that follow each other with nothing but that
 * agent's own output between them get a quiet "Follow-up run" divider instead
 * of being merged into one Worked row. A human message, interaction, marker or
 * another agent ends the sequence.
 */
export function markFollowUpRuns(
  items: readonly TaskChatItem[],
  metaById: ReadonlyMap<string, SettledTurnMergeMeta>,
  runIdByCommentId: ReadonlyMap<string, string>,
): TaskChatItem[] {
  const out: TaskChatItem[] = [];
  let previous: { agentId: string; runId: string } | null = null;
  for (const item of items) {
    let owner: { agentId: string; runId: string } | null = null;
    if (item.kind === "turn") {
      const agentId = metaById.get(item.id)?.agentKey;
      if (agentId) owner = { agentId, runId: turnRunId(item.id) };
    } else if (item.kind === "message" && item.author === "agent") {
      if (item.interstitial) {
        out.push(item);
        continue;
      }
      const agentId = item.agent?.id;
      const runId = item.attachedTurn
        ? turnRunId(item.attachedTurn.id)
        : runIdByCommentId.get(item.id);
      if (agentId && runId) owner = { agentId, runId };
    }
    if (
      owner &&
      previous &&
      previous.agentId === owner.agentId &&
      previous.runId !== owner.runId
    ) {
      const marker: TaskChatMarkerItem = {
        id: `${owner.runId}:ppclip-follow-up`,
        kind: "marker",
        variant: "turn_boundary",
        label: FOLLOW_UP_RUN_LABEL,
        detail: FOLLOW_UP_RUN_DETAIL,
      };
      out.push(marker);
    }
    previous = owner;
    out.push(item);
  }
  return out;
}

/**
 * ppclip CHAT-4 final assembly, replacing official's
 * `attachSettledTurns(coalesceSettledTurns(out, meta), meta)`:
 * - never merge separate runs into one Worked row (no coalescing);
 * - place classic activity below its run's last reply (owner choice);
 * - attach only Paperclip Runner turns to their reply (official renders those
 *   above the answer and keeps the footer); classic turns stay standalone rows
 *   so they never take over the reply's timestamp/actions footer;
 * - mark consecutive separate runs of the same agent as follow-ups.
 */
export function arrangeRunActivity(
  items: readonly TaskChatItem[],
  {
    settledTurns,
    metaById,
    comments,
  }: {
    settledTurns: readonly {
      turn: TaskChatTurnItem;
      anchorCommentId: string | null;
    }[];
    metaById: ReadonlyMap<string, SettledTurnMergeMeta>;
    comments: readonly RunReplyComment[];
  },
): TaskChatItem[] {
  const replyIdByTurnId = new Map<string, string>();
  for (const { turn, anchorCommentId } of settledTurns) {
    if (anchorCommentId && !turn.standaloneHeader)
      replyIdByTurnId.set(turn.id, anchorCommentId);
  }
  const runIdByCommentId = new Map<string, string>();
  for (const comment of comments) {
    const runId = commentRunId(comment);
    if (comment.id && runId) runIdByCommentId.set(comment.id, runId);
  }
  const lifted = placeTurnsBelowReplies(items, replyIdByTurnId, runIdByCommentId);

  const runnerMeta = new Map<string, SettledTurnMergeMeta>();
  for (const item of lifted) {
    if (item.kind !== "turn" || !item.standaloneHeader) continue;
    const meta = metaById.get(item.id);
    if (meta) runnerMeta.set(item.id, meta);
  }
  const attached = attachSettledTurns(lifted, runnerMeta);

  return markFollowUpRuns(attached, metaById, runIdByCommentId);
}
