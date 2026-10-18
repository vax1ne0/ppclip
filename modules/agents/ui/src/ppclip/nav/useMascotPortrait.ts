import { useCallback, useEffect, useState } from "react";
import { agentAvatarUrl, type AgentAppearance, type AgentAvatarSize, type CharacterState } from "@paperclipai/shared";

let renderer: Promise<typeof import("@paperclipai/shared/cliplab/static")> | undefined;
const portraits = new Map<string, { src: string | null; promise: Promise<string> }>();

function renderPortrait(key: string, appearance: AgentAppearance, size: AgentAvatarSize, pose: CharacterState, muted: boolean) {
  const cached = portraits.get(key);
  if (cached) { portraits.delete(key); portraits.set(key, cached); return cached.promise; }
  renderer ??= import("@paperclipai/shared/cliplab/static");
  const entry = { src: null as string | null, promise: Promise.resolve("") };
  entry.promise = renderer.then(library => {
    entry.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(library.renderAgentSvg(appearance, size, 1, pose, muted))}`;
    return entry.src;
  }).catch(error => { if (portraits.get(key) === entry) portraits.delete(key); renderer = undefined; throw error; });
  portraits.set(key, entry);
  if (portraits.size > 128) portraits.delete(portraits.keys().next().value!);
  return entry.promise;
}

/** Small generated portraits bypass cold PNG workers; matching avatars share a bounded local cache. */
export function useMascotPortrait(appearance: AgentAppearance, size: AgentAvatarSize, pose: CharacterState, muted: boolean, imageUrl: string) {
  const local = !appearance.customAvatarAssetId && Boolean(((appearance.customColors || appearance.gradient) && !muted) || (size <= 64 && imageUrl.startsWith("/api/agent-avatars/")));
  // Preserve the host's URL resolver (Storybook supplies packaged portraits).
  const key = local ? agentAvatarUrl(appearance, size, 1, pose, muted) : imageUrl;
  const [portrait, setPortrait] = useState<{ key: string; src: string | null; failed: boolean } | null>(null);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => { portraits.delete(key); setPortrait(null); setRevision(value => value + 1); }, [key]);
  useEffect(() => {
    if (!local) return;
    let cancelled = false;
    void renderPortrait(key, appearance, size, pose, muted).then(src => {
      if (cancelled) return;
      setPortrait({ key, src, failed: false });
    }).catch(() => {
      if (!cancelled) { renderer = undefined; setPortrait({ key, src: null, failed: true }); }
    });
    return () => { cancelled = true; };
    // The URL key encodes every appearance field used by the still renderer.
  }, [key, local, revision]);
  const cachedSrc = local ? portraits.get(key)?.src : null;
  return { key, src: local ? cachedSrc ?? (portrait?.key === key ? portrait.src : null) : key, local, failed: local && !cachedSrc && portrait?.key === key && portrait.failed, retry };
}
