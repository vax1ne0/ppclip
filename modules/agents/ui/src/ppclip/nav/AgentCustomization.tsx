import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AGENT_PALETTE_IDS, CHARACTER_STATES, appearanceForPalette, randomAgentAppearance, resolveAgentAppearance, resolveAgentColors, type Agent, type AgentAppearance, type CharacterState } from "@paperclipai/shared";
import { Shuffle } from "lucide-react";
import { agentsApi } from "@/api/agents";
import { AgentAvatar } from "@/components/AgentAvatar";
import { AgentCharacter } from "@/components/AgentCharacter";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/select";
import { cn } from "@/lib/utils";

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
    choose(next.paletteId === draft.paletteId
      ? appearanceForPalette(AGENT_PALETTE_IDS[(AGENT_PALETTE_IDS.indexOf(draft.paletteId) + 1) % AGENT_PALETTE_IDS.length]) : next);
  }
  return <section className="space-y-6" aria-labelledby="agent-customization-title">
    <header className="space-y-1">
      <h2 id="agent-customization-title" className="text-xl font-semibold">Customization</h2>
      <p className="max-w-prose text-sm text-muted-foreground">Give {agent.name} a look of their own. Your saved colors follow them across chats, the sidebar and the team canvas.</p>
    </header>
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(240px,300px)_1fr]">
      <div className="space-y-5 lg:sticky lg:top-6">
        <div className="flex min-h-72 items-center justify-center rounded-xl border border-border bg-muted/20" aria-label="Mascot preview">
          <AgentCharacter appearance={draft} name={agent.name} size={256} state={pose} trackingScope="region" label={`${agent.name} mascot preview`} />
        </div>
        <label className="block space-y-2 text-sm font-medium">Preview expression
          <NativeSelect aria-label="Preview expression" value={pose} onChange={event => setPose(event.target.value as CharacterState)}>
            {CHARACTER_STATES.map(state => <option key={state} value={state}>{label(state)}</option>)}
          </NativeSelect>
        </label>
        <p className="text-xs leading-relaxed text-muted-foreground">Expressions are a preview. During runs, the mascot responds to the agent’s real status and respects reduced-motion settings.</p>
        <Button type="button" variant="outline" disabled={save.isPending} onClick={randomize}><Shuffle className="size-4" aria-hidden="true" />Surprise me</Button>
      </div>
      <fieldset className="min-w-0 space-y-5" disabled={save.isPending}>
        <legend className="text-sm font-medium">Body colors</legend>
        <p className="text-sm text-muted-foreground">Make your own gradient with any two colors. Use the same color twice for a solid look.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(["a", "b"] as const).map((key, index) => {
            const name = index === 0 ? "Top color" : "Bottom color";
            const invalid = !/^#[0-9a-fA-F]{6}$/.test(colorInputs[key]);
            return <div key={key} className="space-y-2">
              <label htmlFor={`mascot-color-${key}`} className="text-sm font-medium">{name}</label>
              <div className="flex items-center gap-2">
                <input type="color" aria-label={`${name} picker`} value={resolveAgentColors(draft)[key]} onChange={event => changeColor(key, event.target.value)} className="h-10 w-12 cursor-pointer rounded-md border border-input bg-background p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                <input id={`mascot-color-${key}`} value={colorInputs[key]} onChange={event => changeColor(key, event.target.value)} spellCheck={false} maxLength={7} aria-invalid={invalid} aria-describedby={invalid ? `mascot-color-${key}-error` : undefined} className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </div>
              {invalid && <p id={`mascot-color-${key}-error`} className="text-xs text-destructive">Enter a six-digit hex color, such as #8bd4ff.</p>}
            </div>;
          })}
        </div>
        <Button type="button" variant="outline" disabled={invalidColors} onClick={() => {
          const { customAvatarAssetId: _avatar, ...appearance } = draft;
          choose({ ...appearance, customColors: { a: colorInputs.b.toLowerCase(), b: colorInputs.a.toLowerCase() } });
        }}>Swap colors</Button>
        {saved.customAvatarAssetId && <p className="text-xs text-muted-foreground">This agent currently uses an uploaded image. Saving a palette switches back to the animated mascot.</p>}
        <details>
        <summary className="cursor-pointer py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Preset starting points</summary>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {AGENT_PALETTE_IDS.map(palette => {
            const selected = !draft.customAvatarAssetId && !draft.customColors && draft.paletteId === palette;
            return <button key={palette} type="button" aria-label={label(palette)} aria-pressed={selected}
              onClick={() => choose(appearanceForPalette(palette))}
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
    <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background py-4">
      <p role={save.isError ? "alert" : "status"} className={cn("text-sm", save.isError ? "text-destructive" : "text-muted-foreground")}>
        {save.isError ? (save.error instanceof Error ? save.error.message : "Could not save appearance. Try again.") : save.isPending ? "Saving appearance…" : invalidColors ? "Fix the color values before saving." : dirty ? "Preview only. Save to apply this appearance." : savedNotice ? "Appearance saved." : "Edit the colors or choose a preset to preview."}
      </p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" disabled={!dirty || save.isPending} onClick={() => choose(saved)}>Discard</Button>
        <Button type="button" disabled={!dirty || invalidColors || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save appearance"}</Button>
      </div>
    </footer>
  </section>;
}
