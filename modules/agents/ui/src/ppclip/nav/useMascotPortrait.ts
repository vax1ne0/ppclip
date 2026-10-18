import { useCallback, useEffect, useState } from "react";
import { agentAvatarUrl, type AgentAppearance, type AgentAvatarSize, type CharacterState } from "@paperclipai/shared";

let renderer: Promise<typeof import("@paperclipai/shared/cliplab/static")> | undefined;

/** Custom stills render locally; picker drags never flood the server's PNG pool. */
export function useMascotPortrait(appearance: AgentAppearance, size: AgentAvatarSize, pose: CharacterState, muted: boolean, imageUrl: string) {
  const local = Boolean((appearance.customColors || appearance.gradient) && !appearance.customAvatarAssetId && !muted);
  // Preserve the host's URL resolver (Storybook supplies packaged portraits).
  const key = local ? agentAvatarUrl(appearance, size, 1, pose, muted) : imageUrl;
  const [portrait, setPortrait] = useState<{ key: string; src: string | null; failed: boolean } | null>(null);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => { setPortrait(null); setRevision(value => value + 1); }, []);
  useEffect(() => {
    if (!local) return;
    let cancelled = false;
    renderer ??= import("@paperclipai/shared/cliplab/static");
    void renderer.then(library => {
      if (cancelled) return;
      const svg = library.renderAgentSvg(appearance, size, 1, pose, muted);
      setPortrait({ key, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, failed: false });
    }).catch(() => {
      if (!cancelled) { renderer = undefined; setPortrait({ key, src: null, failed: true }); }
    });
    return () => { cancelled = true; };
    // The URL key encodes every appearance field used by the still renderer.
  }, [key, local, revision]);
  return { key, src: local ? portrait?.key === key ? portrait.src : null : key, local, failed: local && portrait?.key === key && portrait.failed, retry };
}
