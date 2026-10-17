/** ppclip DASH-2: excerpt length before "Read full response". */
const REPLY_EXCERPT_CHARS = 280;

/** The saved final reply of a finished run (official `resultJson.summary`, else `result`); never invented from logs. */
export function savedReply(resultJson: Record<string, unknown> | null | undefined): string | null {
  for (const key of ["summary", "result"] as const) {
    const value = resultJson?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function replyExcerpt(text: string, limit = REPLY_EXCERPT_CHARS): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return { text: `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`, truncated: true };
}
