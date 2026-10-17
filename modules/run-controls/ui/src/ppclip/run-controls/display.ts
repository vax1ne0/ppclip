import type { AgentRunAllowance, TeamRunControlState } from "./api";

export type RunsLeftTone = "muted" | "warning" | "danger" | "draining" | "drained";

/** What the roster shows for one agent's daily allowance. */
export function runsLeftDisplay(row: AgentRunAllowance): { label: string; tone: RunsLeftTone } {
  if (row.drainState === "draining") return { label: "Draining", tone: "draining" };
  if (row.drainState === "drained") return { label: "Drained", tone: "drained" };
  if (row.left === null || row.cap === null) return { label: "∞", tone: "muted" };
  const tone: RunsLeftTone = row.left === 0 ? "danger" : row.left <= 2 ? "warning" : "muted";
  return { label: `${row.left}/${row.cap}`, tone };
}

export function runsLeftTitle(row: AgentRunAllowance, resetsAt: string) {
  if (row.drainState === "draining") return `Draining: current runs can finish; new runs are stopped. ${row.usedToday} run(s) today.`;
  if (row.drainState === "drained") return `Drained: no live runs and new runs are stopped until Resume. ${row.usedToday} run(s) today.`;
  const reset = new Date(resetsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (row.cap === null) {
    return `${row.unlimited ? "Unlimited runs are on." : "No daily run cap."} ${row.usedToday} run(s) today (UTC day).`;
  }
  const counted = Math.max(0, row.usedToday - row.credit);
  const credit = row.credit > 0
    ? ` ${row.credit} run${row.credit === 1 ? "" : "s"} made while unlimited ${row.credit === 1 ? "doesn't" : "don't"} count.`
    : "";
  return `${counted} of ${row.cap} daily runs used.${credit} The cap counts runs started in the current UTC day and resets at ${reset} your time. Queued runs do not count.`;
}

export function unlimitedLabel(team: TeamRunControlState) {
  return team.unlimited === "on" ? "On" : team.unlimited === "mixed" ? "Mixed" : "Off";
}

export function drainLabel(team: TeamRunControlState) {
  if (team.drain === "draining") return "Draining";
  if (team.drain === "drained") return "Drained";
  return "Drain";
}
