import { HexColorPicker } from "react-colorful";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Uses the same react-colorful picker and popover as team role-group colors. */
export function MascotColorField({ id, label, value, previewColor, onChange }: {
  id: string; label: string; value: string; previewColor: string; onChange: (color: string) => void;
}) {
  const invalid = !/^#[0-9a-fA-F]{6}$/.test(value);
  return <div className="space-y-2">
    <label htmlFor={id} className="text-sm font-medium">{label}</label>
    <div className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label={`${label} picker`} title={`Choose ${label.toLowerCase()}`} className="size-10 shrink-0 rounded-md border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ backgroundColor: previewColor }} />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto space-y-3" aria-label={`${label} palette`}>
          <p className="text-sm font-medium">{label}</p>
          <HexColorPicker color={previewColor} onChange={onChange} aria-label={`${label} custom color`} />
          <p className="text-xs text-muted-foreground">Drag to preview the mascot live.</p>
        </PopoverContent>
      </Popover>
      <input id={id} value={value} onChange={event => onChange(event.target.value)} spellCheck={false} maxLength={7} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined} className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
    </div>
    {invalid && <p id={`${id}-error`} className="text-xs text-destructive">Enter a six-digit hex color.</p>}
  </div>;
}
