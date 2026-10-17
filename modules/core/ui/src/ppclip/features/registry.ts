/**
 * ppclip modules shown in Settings → ppclip. Keys mirror
 * server/src/ppclip/features.ts. Every module is on by default; turning one off
 * brings back official Paperclip's own behaviour for that area.
 */
export type PpclipFeatureKey =
  | "team"
  | "liveRuns"
  | "providerUsage"
  | "providerRouting"
  | "runControls"
  | "computerUse"
  | "urgencyOrder"
  | "attention"
  | "rosterExtras"
  | "taskChatRuns"
  | "staleRunningRepair"
  | "liveRefresh"
  | "deletedCommentReply"
  | "windowsSignIn";
export type PpclipFeatures = Record<PpclipFeatureKey, boolean>;

export type PpclipFeatureInfo = {
  key: PpclipFeatureKey;
  title: string;
  /** What turning it on gives you. */
  description: string;
  /** What happens when it is off, or anything else worth knowing. */
  footnote?: string;
};
type PpclipModuleGroup = { id: string; title: string; description: string; features: PpclipFeatureInfo[] };

export const PPCLIP_MODULES: PpclipModuleGroup[] = [
  {
    id: "pages",
    title: "Pages",
    description: "Extra pages for watching your agents.",
    features: [
      {
        key: "team",
        title: "Team page",
        description: "A canvas of your agents at /team with their reporting and work lines, Edit mode, Magic sort and group colours, plus a Team link in the sidebar under Inbox.",
        footnote: "Off: the Team link disappears and /team goes back to the dashboard. Saved layouts and colours are kept.",
      },
      {
        key: "liveRuns",
        title: "Live runs",
        description: "The Live runs page shows one large card per agent with its live activity, current task and last reply. The dashboard's Agents heading opens it.",
        footnote: "Off: Live runs shows official Paperclip's run cards, and the Agents heading is plain text again.",
      },
    ],
  },
  {
    id: "providers",
    title: "Providers",
    description: "Usage of your AI accounts, and moving agents between providers.",
    features: [
      {
        key: "providerUsage",
        title: "Usage bars and subscription usage",
        description: "Usage bars for each connected AI account in the top bar, and a Subscription usage panel at the bottom of the dashboard. Usage comes from official Connections and is checked every 5 minutes.",
        footnote: "Off: no usage bars or dashboard panel, and no usage checks are made.",
      },
      {
        key: "providerRouting",
        title: "Provider switching",
        description: "The Providers panel in the top bar, where you can let idle agents move to another provider when theirs runs out (Hybrid, or one provider only), with model tiers that pair equivalent models.",
        footnote: "Switching itself stays off until you turn it on in that panel. Off here: the panel and mode switch are hidden and no agent is moved. Agents already moved keep their current settings.",
      },
    ],
  },
  {
    id: "run-controls",
    title: "Run controls",
    description: "Limits on how much your team runs.",
    features: [
      {
        key: "runControls",
        title: "Run controls",
        description: "Team Unlimited / Drain / Resume, daily runs left on the Agents page, and “Drain after next run” on each agent.",
        footnote: "This makes the feature available. It still has its own switch in Company Settings, which is off by default. Off here: the controls are hidden and daily caps work exactly as in official Paperclip.",
      },
    ],
  },
  {
    id: "computer-use",
    title: "Computer use",
    description: "A sandboxed desktop and browser per agent.",
    features: [
      {
        key: "computerUse",
        title: "Computer use",
        description: "Lets chosen agents use their own sandboxed Linux desktop and Chromium in Docker, which you can watch live, take over and release from their Live runs card.",
        footnote: "Needs Docker and its own switches in Company Settings and on each agent, all off by default. Off here: the settings and live view are hidden, and agents get no computer tools.",
      },
    ],
  },
  {
    id: "agents",
    title: "Agents and sidebar",
    description: "Seeing which agents need you.",
    features: [
      {
        key: "urgencyOrder",
        title: "Urgent agents first",
        description: "The sidebar's agent lists put agents that are waiting for you or blocked at the top, keeping your chosen order within each group.",
        footnote: "Off: the sidebar uses official Paperclip's order only.",
      },
      {
        key: "attention",
        title: "Attention statuses",
        description: "“Waiting for you”, “Pending on agent” and “Blocked task” statuses on agents, and a pending confirmations list on the Agents page.",
        footnote: "Off: agents show official Paperclip's statuses.",
      },
      {
        key: "rosterExtras",
        title: "Agents page extras",
        description: "Extra columns on the Agents page (model and provider, runs left), and the agent's open tasks when you hover its name.",
      },
    ],
  },
  {
    id: "task-chat",
    title: "Task chat",
    description: "How run activity reads inside a task.",
    features: [
      {
        key: "taskChatRuns",
        title: "Clearer run activity",
        description: "A task's chat hides activity from runs that belong to other tasks, keeps separate runs apart with a “Follow-up run” divider, puts each run's Worked row under its reply, and matches agents by ID rather than name.",
        footnote: "Off: task chat groups run activity exactly as official Paperclip does.",
      },
    ],
  },
  {
    id: "fixes",
    title: "Fixes",
    description: "Small repairs to official behaviour.",
    features: [
      {
        key: "staleRunningRepair",
        title: "Repair agents stuck on “running”",
        description: "Agents left “running” with no live or queued run are set back to idle during the server's regular recovery pass.",
      },
      {
        key: "liveRefresh",
        title: "Refresh live lists when a run finishes",
        description: "The dashboard's Agents section and Live runs refresh as soon as a run ends instead of waiting for the next poll.",
      },
      {
        key: "deletedCommentReply",
        title: "Ignore deleted replies",
        description: "A comment you deleted no longer counts as the agent's reply to its run.",
      },
      {
        key: "windowsSignIn",
        title: "Claude and Codex sign-in on Windows",
        description: "Sign-in runs in a Windows terminal instead of Python's pty (which Windows lacks), shows PowerShell commands, and reads saved credentials the Windows way.",
        footnote: "Only matters when the server runs on Windows. Off: sign-in from the app fails on Windows.",
      },
    ],
  },
];

export const PPCLIP_FEATURE_KEYS = PPCLIP_MODULES.flatMap((group) => group.features.map((feature) => feature.key));

export function defaultPpclipFeatures(): PpclipFeatures {
  return Object.fromEntries(PPCLIP_FEATURE_KEYS.map((key) => [key, true])) as PpclipFeatures;
}
