/**
 * ppclip TEAM-1/TEAM-2: role families and their colours on the Team canvas.
 *
 * Families are derived from official agent roles, so new agents join a group
 * automatically. Colours only reference existing design tokens (the brand agent
 * hues in ui/src/index.css); a custom colour is a validated runtime value the
 * owner picked, never a literal in code.
 */
export type TeamRoleGroup = { key: string; label: string };

export const TEAM_ROLE_GROUPS: readonly TeamRoleGroup[] = [
  { key: "leadership", label: "Leadership" },
  { key: "engineering", label: "Engineering" },
  { key: "quality", label: "Quality & review" },
  { key: "design", label: "Design" },
  { key: "research", label: "Research" },
  { key: "other", label: "Other roles" },
];
export const TEAM_ROLE_GROUP_ORDER = TEAM_ROLE_GROUPS.map((group) => group.key);

const ROLE_TO_GROUP: Record<string, string> = {
  ceo: "leadership",
  cto: "leadership",
  cmo: "leadership",
  cfo: "leadership",
  pm: "leadership",
  engineer: "engineering",
  devops: "engineering",
  qa: "quality",
  security: "quality",
  designer: "design",
  researcher: "research",
};

const GROUPS_BY_KEY = new Map(TEAM_ROLE_GROUPS.map((group) => [group.key, group]));

export function roleGroupOf(agent: { role?: string | null }): TeamRoleGroup {
  return GROUPS_BY_KEY.get(ROLE_TO_GROUP[agent.role ?? ""] ?? "other")!;
}

/** Preset swatches offered for every group, in display order. */
export const TEAM_PALETTE = ["default", "neutral", "blue", "green", "purple", "amber"] as const;
export type TeamPresetColor = (typeof TEAM_PALETTE)[number];

export const TEAM_PRESET_LABELS: Record<TeamPresetColor, string> = {
  default: "Group default",
  neutral: "Neutral",
  blue: "Blue",
  green: "Green",
  purple: "Purple",
  amber: "Amber",
};

const NEUTRAL = "var(--muted-foreground)";
const PRESET_TOKENS: Record<Exclude<TeamPresetColor, "default">, string> = {
  neutral: NEUTRAL,
  blue: "var(--agent-5a)",
  green: "var(--agent-1b)",
  purple: "var(--agent-8b)",
  amber: "var(--agent-4b)",
};
const GROUP_DEFAULT_TOKENS: Record<string, string> = {
  leadership: PRESET_TOKENS.amber,
  engineering: PRESET_TOKENS.blue,
  quality: PRESET_TOKENS.green,
  design: "var(--agent-2b)",
  research: "var(--agent-10b)",
  other: NEUTRAL,
};

export const isCustomTeamColor = (color: unknown): color is string =>
  typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color);
export const isTeamPaletteValue = (color: unknown): color is string =>
  isCustomTeamColor(color) || (TEAM_PALETTE as readonly unknown[]).includes(color);

/** Resolve a stored palette choice to a CSS colour (a token reference or a validated custom hex). */
export function teamGroupColor(groupKey: string, choice: string | undefined, colorsOn = true): string {
  if (!colorsOn) return NEUTRAL;
  if (isCustomTeamColor(choice)) return choice;
  if (choice && choice !== "default" && choice in PRESET_TOKENS) return PRESET_TOKENS[choice as keyof typeof PRESET_TOKENS];
  return GROUP_DEFAULT_TOKENS[groupKey] ?? NEUTRAL;
}
