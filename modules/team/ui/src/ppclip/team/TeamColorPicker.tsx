import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check } from "lucide-react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { isCustomTeamColor, TEAM_PALETTE, TEAM_PRESET_LABELS, teamGroupColor, type TeamPresetColor } from "./role-groups";

/** The picker follows the pointer every frame; the canvas and saved layout follow at this cadence. */
export const TEAM_CUSTOM_COLOR_COMMIT_MS = 120;

/** A hue wheel built only from design tokens, for the "Custom colour" swatch. */
const CUSTOM_SWATCH_STYLE: CSSProperties = {
  backgroundImage: "conic-gradient(var(--agent-6a), var(--agent-4b), var(--agent-1b), var(--agent-10b), var(--agent-5a), var(--agent-8b), var(--agent-6a))",
};

const toHex = (channels: number[]) => `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;

/** Resolve the colour a swatch is rendered with (tokens may be oklch) to the hex the picker edits. */
export function renderedColorHex(element: Element | null): string | null {
  if (!element) return null;
  try {
    const color = getComputedStyle(element).backgroundColor;
    const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(color);
    if (rgb) return toHex(rgb.slice(1, 4).map(Number));
    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    return toHex([...context.getImageData(0, 0, 1, 1).data.slice(0, 3)]);
  } catch {
    return null;
  }
}

const swatchClass = "relative inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border shadow-xs outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring";

/**
 * ppclip TEAM-2: a group's colour swatch. Presets apply at once and close the
 * palette; the custom picker commits at most every 120ms and flushes on close.
 */
export function TeamColorPicker({ group, label, value, onChange }: {
  group: string;
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(isCustomTeamColor(value));
  const [draft, setDraft] = useState<string | null>(isCustomTeamColor(value) ? value : null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const color = pending.current;
    pending.current = null;
    if (color) onChangeRef.current(color);
  };
  useEffect(() => flush, []);
  useEffect(() => {
    if (isCustomTeamColor(value) && !pending.current) setDraft(value);
  }, [value]);

  const changeCustom = (color: string) => {
    if (!isCustomTeamColor(color)) return;
    setDraft(color);
    pending.current = color.toLowerCase();
    timer.current ??= setTimeout(flush, TEAM_CUSTOM_COLOR_COMMIT_MS);
  };
  const choosePreset = (color: TeamPresetColor) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    onChange(color);
    setOpen(false);
  };
  const openCustom = () => {
    setCustomOpen(true);
    // Start from whatever the group is showing right now.
    if (!draft) setDraft(renderedColorHex(trigger.current));
  };

  const shown = pending.current ?? value;
  const customSelected = isCustomTeamColor(shown);
  const fill = (choice: string): CSSProperties => ({ backgroundColor: teamGroupColor(group, choice) });

  return (
    <Popover open={open} onOpenChange={(next) => { if (!next) flush(); setOpen(next); }}>
      <PopoverTrigger asChild>
        <button
          ref={trigger}
          type="button"
          className={swatchClass}
          style={fill(shown)}
          aria-label={`${label} colour: ${customSelected ? shown : TEAM_PRESET_LABELS[shown as TeamPresetColor] ?? shown}`}
          title={`Change ${label} colour`}
          data-team-color={customSelected ? "custom" : shown}
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto space-y-3" aria-label={`${label} colour palette`}>
        <p className="text-sm font-medium">{label}</p>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Colours">
          {TEAM_PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              className={swatchClass}
              style={fill(color)}
              aria-label={TEAM_PRESET_LABELS[color]}
              aria-pressed={shown === color}
              title={TEAM_PRESET_LABELS[color]}
              onClick={() => choosePreset(color)}
            >
              {shown === color ? <Check className="size-3 text-background" aria-hidden="true" /> : null}
            </button>
          ))}
          <button
            type="button"
            className={swatchClass}
            style={customSelected ? fill(shown) : CUSTOM_SWATCH_STYLE}
            aria-label="Custom colour"
            aria-pressed={customSelected}
            aria-expanded={customOpen}
            title="Custom colour"
            data-team-color="custom"
            onClick={openCustom}
          >
            {customSelected ? <Check className="size-3 text-background" aria-hidden="true" /> : null}
          </button>
        </div>
        {customOpen ? (
          <div className="space-y-2 border-t border-border pt-3">
            <HexColorPicker color={draft ?? undefined} onChange={changeCustom} aria-label={`${label} custom colour`} />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Hex
              <HexColorInput
                prefixed
                color={draft ?? ""}
                onChange={changeCustom}
                onBlur={flush}
                aria-label={`${label} custom hex colour`}
                className={cn("h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2 font-mono text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring")}
              />
            </label>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
