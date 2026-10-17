import type { AiConnectionUsage, AiConnectionUsageLimit } from "@paperclipai/shared";
import { getQuotaWindows } from "@paperclipai/adapter-claude-local/server";
import type { QuotaWindow } from "@paperclipai/adapter-utils";

/**
 * Claude usage read from this computer's own Claude Code sign-in.
 *
 * Paperclip connects Claude through `claude setup-token`, whose token only has
 * the `user:inference` permission; Anthropic's usage API needs `user:profile`
 * and answers 403 for it, so a connected Claude account can never report
 * usage. This computer's Claude Code login has that permission, so ppclip
 * shows its usage instead, labelled as coming from this computer.
 *
 * Uses official's claude-local helper, which only reads the saved login (an
 * expired token is skipped; Claude Code renews it whenever it is used) and
 * never refreshes or writes it.
 */

const ACCOUNT_WIDE = /^(current session|current week \(all models\)|5h|7d)$/i;

function toUsage(windows: QuotaWindow[]): AiConnectionUsage {
  const limits = windows.map((window, index): AiConnectionUsageLimit => ({
    id: `claude_code_${index}`,
    label: window.label,
    // Account-wide windows headline the bar; model-specific ones stay in the details.
    scope: ACCOUNT_WIDE.test(window.label) ? null : window.label,
    windowDurationSeconds: /session|5h/i.test(window.label) ? 18_000 : /week|7d/i.test(window.label) ? 604_800 : null,
    resetsAt: window.resetsAt,
    usedPercent: window.usedPercent,
    remainingPercent: window.usedPercent == null ? null : Math.max(0, 100 - window.usedPercent),
    used: null, limit: null, remaining: null, unit: "percent", limitReached: null, allowed: null,
  }));
  return {
    connectionId: "claude-code-on-this-computer", grantId: "", provider: "anthropic", method: "subscription",
    status: "ok", errorCode: null, checkedAt: new Date().toISOString(), source: "claude_code_local", planType: null,
    limits, overage: null,
  } as unknown as AiConnectionUsage;
}

/** Usage from this computer's Claude Code sign-in, or null when it can't be read. */
export async function hostClaudeUsage(): Promise<AiConnectionUsage | null> {
  const result = await getQuotaWindows().catch(() => null);
  return result?.ok && result.windows.length ? toUsage(result.windows) : null;
}
