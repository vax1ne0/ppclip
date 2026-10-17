/** The model an agent is configured with (trimmed), or null. Official's equivalent is private to its Agents page. */
export function configuredModel(adapterConfig: Record<string, unknown> | null | undefined): string | null {
  const value = adapterConfig?.model;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
