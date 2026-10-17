import { useId } from "react";
import { RotateCcw, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Separator } from "@/components/ui/separator";
import { TeamColorPicker } from "./TeamColorPicker";
import type { TeamRoleGroup } from "./role-groups";
import type { TeamGrouping, TeamPreferences } from "./team-layout";

type Toggle = "reporting" | "work" | "arrows" | "labels" | "snap" | "colors";
const TOGGLES: readonly [Toggle, string][] = [
  ["reporting", "Reporting lines"],
  ["work", "Work arrows"],
  ["arrows", "Arrowheads"],
  ["labels", "Group labels and depth dots"],
  ["snap", "Snap cards into alignment"],
  ["colors", "Role colours"],
];

/** ppclip TEAM-1/TEAM-2: the Team canvas view settings (this browser only). */
export function TeamViewSettings({ settings, update, editing, maxDepth, groups, onShowAll, onRestoreDefault }: {
  settings: TeamPreferences;
  update: <K extends keyof TeamPreferences>(key: K, value: TeamPreferences[K]) => void;
  editing: boolean;
  maxDepth: number;
  groups: TeamRoleGroup[];
  onShowAll: () => void;
  onRestoreDefault: () => void;
}) {
  const id = useId();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon-sm" variant="outline" aria-label="View settings" title="View settings">
          <Settings2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-4" aria-label="Team view settings">
        <PopoverHeader>
          <PopoverTitle>Team view</PopoverTitle>
          <PopoverDescription className="text-xs">
            Layout and appearance for this browser. Nothing here changes who reports to whom or who owns a task.
          </PopoverDescription>
        </PopoverHeader>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <label htmlFor={`${id}-grouping`}>Group cards by</label>
            <Select value={settings.grouping} onValueChange={(value) => update("grouping", value as TeamGrouping)}>
              <SelectTrigger id={`${id}-grouping`} size="sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="reports">Reporting level</SelectItem>
                <SelectItem value="roles">Role</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <label htmlFor={`${id}-levels`}>Hierarchy depth</label>
            <Select value={String(settings.levels)} onValueChange={(value) => update("levels", Number(value))}>
              <SelectTrigger id={`${id}-levels`} size="sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">All levels</SelectItem>
                {Array.from({ length: maxDepth + 1 }, (_, index) => (
                  <SelectItem key={index} value={String(index + 1)}>{index + 1} level{index ? "s" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            {editing ? "Magic sort uses this grouping." : "Turn on Edit mode to move cards or use Magic sort."}
          </p>
        </div>

        <Separator />
        <div className="flex flex-col gap-2.5">
          {TOGGLES.map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-3 text-sm">
              <label htmlFor={`${id}-${key}`}>{label}</label>
              <ToggleSwitch id={`${id}-${key}`} checked={settings[key]} onCheckedChange={(checked) => update(key, checked)} />
            </div>
          ))}
        </div>

        {settings.colors && groups.length ? (
          <>
            <Separator />
            <div className="flex flex-col gap-2.5" role="group" aria-label="Role colours">
              {groups.map((group) => (
                <div key={group.key} className="flex items-center justify-between gap-3 text-sm">
                  <span>{group.label}</span>
                  <TeamColorPicker
                    group={group.key}
                    label={group.label}
                    value={settings.palette[group.key] ?? "default"}
                    onChange={(color) => update("palette", { ...settings.palette, [group.key]: color })}
                  />
                </div>
              ))}
            </div>
          </>
        ) : null}

        <Separator />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onShowAll}>Show all agents</Button>
          <Button size="sm" variant="outline" disabled={!editing} onClick={onRestoreDefault}>
            <RotateCcw />
            Restore default view
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
