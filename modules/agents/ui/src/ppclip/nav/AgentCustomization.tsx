import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AGENT_PALETTE_IDS, CHARACTER_STATES, DEFAULT_AGENT_GRADIENT, appearanceForPalette, randomAgentAppearance, resolveAgentAppearance, resolveAgentColors, type Agent, type AgentAppearance, type CharacterState } from "@paperclipai/shared";
import { Shuffle } from "lucide-react";
import { agentsApi } from "@/api/agents";
import { AgentAvatar } from "@/components/AgentAvatar";
import { AgentCharacter } from "@/components/AgentCharacter";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { MascotColorField } from "./MascotColorField";
import { PageActionBar } from "./PageActionBar";
import { MascotGradientGuide, type MascotGradient } from "./MascotGradientGuide";

type Identity = Pick<Agent, "id" | "name" | "companyId" | "appearance">;
const label = (value: string) => value.split("-").map(word => word[0].toUpperCase() + word.slice(1)).join(" ");
const same = (a: AgentAppearance, b: AgentAppearance) => JSON.stringify(a) === JSON.stringify(b);

/** Uses the existing company-scoped appearance update; previews never write. */
export function AgentCustomization({ agent, onDirtyChange, onSavingChange }: {
  agent: Identity;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
}) {
  const client = useQueryClient();
  const [saved, setSaved] = useState(() => resolveAgentAppearance(agent.appearance, agent.id));
  const [draft, setDraft] = useState(saved);
  const [colorInputs, setColorInputs] = useState(() => resolveAgentColors(saved));
  const [pose, setPose] = useState<CharacterState>("idle");
  const [showGuide, setShowGuide] = useState(false);
  const gradient = draft.gradient ?? DEFAULT_AGENT_GRADIENT;
  const [savedNotice, setSavedNotice] = useState(false);
  const invalidColors = !Object.values(colorInputs).every(value => /^#[0-9a-fA-F]{6}$/.test(value));
  const dirty = !same(draft, saved) || invalidColors;
  const appearanceKey = JSON.stringify(agent.appearance);
  useEffect(() => {
    // A background refresh must not replace an unsaved draft.
    if (!dirty) {
      const next = resolveAgentAppearance(agent.appearance, agent.id);
      setSaved(next); setDraft(next); setColorInputs(resolveAgentColors(next));
    }
  }, [agent.id, appearanceKey]);
  const save = useMutation({
    mutationFn: () => agentsApi.update(agent.id, { appearance: draft }, agent.companyId),
    onSuccess: updated => {
      const next = resolveAgentAppearance(updated.appearance, agent.id);
      setSaved(next); setDraft(next); setColorInputs(resolveAgentColors(next)); setSavedNotice(true);
      void client.invalidateQueries({ queryKey: ["agents"] });
    },
  });
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);
  useEffect(() => { onSavingChange?.(save.isPending); }, [save.isPending, onSavingChange]);
  useEffect(() => () => { onSavingChange?.(false); }, [onSavingChange]);

  function choose(next: AgentAppearance) { setDraft(next); setColorInputs(resolveAgentColors(next)); setSavedNotice(false); save.reset(); }
  function choosePalette(next: AgentAppearance) { choose({ ...next, ...(draft.gradient ? { gradient: draft.gradient } : {}) }); }
  function changeGradient(next: MascotGradient) {
    const { customAvatarAssetId: _avatar, ...appearance } = draft;
    choose({ ...appearance, gradient: next });
  }
  function changeColor(key: "a" | "b", value: string) {
    const colors = { ...colorInputs, [key]: value };
    setColorInputs(colors); setSavedNotice(false); save.reset();
    if (Object.values(colors).every(color => /^#[0-9a-fA-F]{6}$/.test(color))) {
      const { customAvatarAssetId: _avatar, ...appearance } = draft;
      setDraft({ ...appearance, customColors: { a: colors.a.toLowerCase(), b: colors.b.toLowerCase() } });
    }
  }
  function randomize() {
    const next = randomAgentAppearance();
    choosePalette(next.paletteId === draft.paletteId
      ? appearanceForPalette(AGENT_PALETTE_IDS[(AGENT_PALETTE_IDS.indexOf(draft.paletteId) + 1) % AGENT_PALETTE_IDS.length]) : next);
  }
  return <section className="space-y-6" aria-labelledby="agent-customization-title">
    <header className="space-y-1">
      <h2 id="agent-customization-title" className="text-xl font-semibold">Customization</h2>
      <p className="max-w-prose text-sm text-muted-foreground">Give {agent.name} a look of their own. Your saved colors follow them across chats, the sidebar and the team canvas.</p>
    </header>
    <div className="grid items-start gap-8 lg:grid-cols-2">
      <div className="space-y-5 lg:sticky lg:top-6">
        <div className="flex min-h-72 items-center justify-center rounded-xl border border-border bg-muted/20" aria-label="Mascot preview">
          <div className={cn("relative size-64", showGuide && "touch-none")}>
            <AgentCharacter appearance={draft} name={agent.name} size={256} state={showGuide ? "rest" : pose} motion={showGuide ? "still" : "auto"} trackingScope="region" label={`${agent.name} mascot preview`} />
            {showGuide && <MascotGradientGuide value={gradient} onChange={changeGradient} />}
          </div>
        </div>
        <label className="block space-y-2 text-sm font-medium">Preview expression
          <NativeSelect aria-label="Preview expression" value={pose} disabled={showGuide} onChange={event => setPose(event.target.value as CharacterState)}>
            {CHARACTER_STATES.map(state => <option key={state} value={state}>{label(state)}</option>)}
          </NativeSelect>
        </label>
        <p className="text-xs leading-relaxed text-muted-foreground">Expressions are a preview. During runs, the mascot responds to the agent’s real status and respects reduced-motion settings.</p>
        <Button type="button" variant="outline" disabled={save.isPending} onClick={randomize}><Shuffle className="size-4" aria-hidden="true" />Surprise me</Button>
      </div>
      <fieldset className="min-w-0 space-y-5" disabled={save.isPending}>
        <legend className="text-sm font-medium">Body colors</legend>
        <p className="text-sm text-muted-foreground">Pick two colors for a gradient, or match them for a solid look. The preview follows as you drag.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(["a", "b"] as const).map((key, index) => {
            const name = index === 0 ? "Top color" : "Bottom color";
            return <MascotColorField key={key} id={`mascot-color-${key}`} label={name} value={colorInputs[key]} previewColor={resolveAgentColors(draft)[key]} onChange={value => changeColor(key, value)} />;
          })}
        </div>
        <Button type="button" variant="outline" disabled={invalidColors} onClick={() => {
          const { customAvatarAssetId: _avatar, ...appearance } = draft;
          choose({ ...appearance, customColors: { a: colorInputs.b.toLowerCase(), b: colorInputs.a.toLowerCase() } });
        }}>Swap colors</Button>
        <div className="space-y-4 border-t border-border pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Gradient placement</h3>
            <Button type="button" variant="outline" size="sm" aria-pressed={showGuide} onClick={() => setShowGuide(value => !value)}>{showGuide ? "Hide gradient guide" : "Show gradient guide"}</Button>
          </div>
          <p className="text-xs text-muted-foreground">Drag the line’s center to move the blend. Drag its end to rotate. The mascot holds still while the guide is visible.</p>
          {([['x', 'Horizontal center', 0, 100, '%'], ['y', 'Vertical center', 0, 100, '%'], ['angle', 'Gradient angle', -180, 180, '°']] as const).map(([key, name, min, max, unit]) => <label key={key} className="block space-y-2 text-xs">
            <span className="flex justify-between gap-2"><span>{name}</span><output className="tabular-nums text-muted-foreground">{gradient[key]}{unit}</output></span>
            <input type="range" aria-label={name} min={min} max={max} step={1} value={gradient[key]} onChange={event => changeGradient({ ...gradient, [key]: Number(event.target.value) })} className="w-full accent-foreground" />
          </label>)}
          <Button type="button" variant="ghost" size="sm" onClick={() => { const { gradient: _gradient, ...appearance } = draft; choose(appearance); }}>Reset gradient placement</Button>
        </div>
        {saved.customAvatarAssetId && <p className="text-xs text-muted-foreground">This agent currently uses an uploaded image. Saving a palette switches back to the animated mascot.</p>}
        <details>
        <summary className="cursor-pointer py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Preset starting points</summary>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {AGENT_PALETTE_IDS.map(palette => {
            const selected = !draft.customAvatarAssetId && !draft.customColors && draft.paletteId === palette;
            return <button key={palette} type="button" aria-label={label(palette)} aria-pressed={selected}
              onClick={() => choosePalette(appearanceForPalette(palette))}
              className={cn("flex min-w-0 flex-col items-center gap-1 rounded-lg border p-3 text-center text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background", selected ? "border-foreground bg-accent" : "border-border")}>
              <AgentAvatar appearance={appearanceForPalette(palette)} size={64} />
              <span>{label(palette)}</span>
              <span className="min-h-4 text-muted-foreground">{selected ? "Selected" : ""}</span>
            </button>;
          })}
        </div>
        </details>
      </fieldset>
    </div>
    <PageActionBar>
      <p role={save.isError ? "alert" : "status"} className={cn("text-sm", save.isError ? "text-destructive" : "text-muted-foreground")}>
        {save.isError ? (save.error instanceof Error ? save.error.message : "Could not save appearance. Try again.") : save.isPending ? "Saving appearance…" : invalidColors ? "Fix the color values before saving." : dirty ? "Preview only. Save to apply this appearance." : savedNotice ? "Appearance saved." : "Edit the colors or choose a preset to preview."}
      </p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" disabled={!dirty || save.isPending} onClick={() => choose(saved)}>Discard</Button>
        <Button type="button" disabled={!dirty || invalidColors || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save appearance"}</Button>
      </div>
    </PageActionBar>
  </section>;
}
