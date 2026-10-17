import type { AttentionItem } from "@paperclipai/shared";
import type { AgentAttention } from "./agent-attention";

export const EMPTY_ATTENTION: AgentAttention = { waiting: [], dependencies: [], blockedTasks: [] };

/** Test helper: an official attention-feed row for an issue-thread interaction. */
export function feedItem(overrides: Partial<AttentionItem> & {
  policy?: string | null;
  createdBy?: string | null;
  kind?: string;
}): AttentionItem {
  const { policy = "human_only", createdBy = "agent-a", kind = "request_confirmation", ...rest } = overrides;
  return {
    id: `item-${Math.random()}`,
    companyId: "company-1",
    sourceKind: "issue_thread_interaction",
    subject: {
      kind: "interaction",
      id: "interaction-1",
      companyId: "company-1",
      title: "Ship it?",
      identifier: null,
      status: "pending",
      href: "/PAP/issues/PAP-1#interaction-interaction-1",
      metadata: { kind, issueId: "issue-1", createdByAgentId: createdBy },
    },
    whyNow: "",
    decisionVerbs: [],
    inlineResolvable: true,
    entryRule: "",
    exitRule: "",
    dedupKey: "",
    dismissalKey: "",
    dismissal: null,
    severity: "medium",
    rank: 0,
    activityAt: "2026-10-01T00:00:00.000Z",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    relatedIssue: { kind: "issue", id: "issue-1", companyId: "company-1", title: "Launch", identifier: "PAP-1", status: "in_progress", href: "/PAP/issues/PAP-1" },
    project: null,
    workspace: null,
    expiresAt: null,
    ruleKey: null,
    originAgentName: null,
    queues: [],
    shelf: false,
    retentionDays: 30,
    keep: false,
    archivedAt: null,
    retentionVersion: 1,
    decideBy: null,
    decideByAttribution: null,
    snoozedUntil: null,
    detail: null,
    trainingExampleId: null,
    resolverAudience: policy === null ? null : {
      requestedResolverPolicy: policy as "human_only",
      effectiveResolverPolicy: policy as "human_only",
      effectiveResolverPolicySource: "requested",
      resolverPolicyProvenance: "explicit",
      addresseeAgentId: null,
      addresseeName: null,
      createdByAgentId: createdBy,
      createdByAgentName: createdBy ? `Name ${createdBy}` : null,
    },
    ...rest,
  };
}
