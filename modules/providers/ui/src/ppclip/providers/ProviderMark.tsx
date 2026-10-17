import { aiConnectionCatalogSlug } from "@paperclipai/shared";
import { AppLogo } from "@/pages/apps/AppLogo";
import { AI_PROVIDERS } from "@/components/ai-connections/model";
import { cn } from "@/lib/utils";

// Marks drawn in black need their own dark-theme file (as official's connection picker does).
const DARK_LOGOS: Partial<Record<string, string>> = { xai: "/brands/adapters/grok-dark.svg" };

/**
 * A provider's own mark (Codex, Claude, Grok). AppLogo would prefer the
 * app-catalog logo and pads it for large tiles, so it is only the fallback.
 */
export function ProviderMark({ provider, routing, size = 16 }: { provider: string; routing?: Parameters<typeof aiConnectionCatalogSlug>[1]; size?: 16 | 20 }) {
  const meta = AI_PROVIDERS[provider as keyof typeof AI_PROVIDERS];
  if (!meta?.logo) return <AppLogo name={meta?.name ?? provider} brandKey={aiConnectionCatalogSlug(provider, routing)} size={size} compact />;
  const box = size === 20 ? "size-5" : "size-4";
  const dark = DARK_LOGOS[provider];
  return (
    <span className={cn("flex shrink-0 items-center justify-center", box)} aria-hidden>
      <img src={meta.logo} alt="" className={cn(box, "object-contain", dark && "dark:hidden")} />
      {dark ? <img src={dark} alt="" className={cn("hidden object-contain dark:block", box)} /> : null}
    </span>
  );
}
