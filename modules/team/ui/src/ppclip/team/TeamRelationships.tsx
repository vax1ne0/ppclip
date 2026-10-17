import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import type { AgentLinkKind } from "./agent-links";

type TeamRelationshipKind = "report" | AgentLinkKind;
type TeamRelationship = {
  id: string;
  from: string;
  to: string;
  kind: TeamRelationshipKind;
  /** Plain-language sentence, e.g. "Sam reports to Alex". */
  text: string;
  tasks: string[];
  /** Why the line is not on the canvas right now, if it is not. */
  note?: string;
};

type Named = { id: string; name: string };

/** Turn reporting lines and work links into plain-language relationships. */
export function describeRelationships(
  members: (Named & { reportsTo: string | null })[],
  links: { from: string; to: string; kind: AgentLinkKind; tasks: string[] }[],
): TeamRelationship[] {
  const byId = new Map(members.map((member) => [member.id, member]));
  const result: TeamRelationship[] = [];
  for (const member of members) {
    const manager = member.reportsTo && member.reportsTo !== member.id ? byId.get(member.reportsTo) : undefined;
    if (manager) {
      result.push({ id: `report:${member.id}`, from: manager.id, to: member.id, kind: "report", text: `${member.name} reports to ${manager.name}`, tasks: [] });
    }
  }
  for (const link of links) {
    const from = byId.get(link.from), to = byId.get(link.to);
    if (!from || !to) continue;
    result.push({
      id: `${link.kind}:${link.from}:${link.to}`,
      from: link.from,
      to: link.to,
      kind: link.kind,
      text: link.kind === "waiting"
        ? `${from.name} is waiting on ${to.name}`
        : `${from.name} and ${to.name} are passing work back and forth`,
      tasks: link.tasks,
    });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

const SECTION_TITLES: Record<TeamRelationshipKind, string> = {
  report: "Reporting",
  waiting: "Waiting on",
  loop: "Review / fix back-and-forth",
};

/** ppclip TEAM-1: the Relationships popover in the canvas corner. */
export function TeamRelationships({ relationships, evidenceStatus }: { relationships: TeamRelationship[]; evidenceStatus?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="bg-background/80 backdrop-blur-sm">
          Relationships ({relationships.length})
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="flex max-h-(--radix-popover-content-available-height) w-96 flex-col gap-3 overflow-y-auto" aria-label="Team relationships">
        <PopoverHeader>
          <PopoverTitle>Relationships</PopoverTitle>
          <PopoverDescription className="text-xs">
            Solid lines join agents to their managers. Dashed arrows mean one agent is waiting on another’s open task;
            dotted arrows mean work is going back and forth, for example a review and its fixes.
          </PopoverDescription>
        </PopoverHeader>
        {evidenceStatus ? <p className="text-xs text-muted-foreground" role="status">{evidenceStatus}</p> : null}
        {relationships.length === 0 ? <p className="text-sm text-muted-foreground">No reporting lines or shared work yet.</p> : null}
        {(Object.keys(SECTION_TITLES) as TeamRelationshipKind[]).map((kind) => {
          const entries = relationships.filter((relationship) => relationship.kind === kind);
          if (!entries.length) return null;
          return (
            <section key={kind} className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">{SECTION_TITLES[kind]}</h3>
              <ul className="flex flex-col gap-1.5 text-sm">
                {entries.map((relationship) => (
                  <li key={relationship.id}>
                    <span>{relationship.text}</span>
                    {relationship.note ? <span className="text-muted-foreground"> · {relationship.note}</span> : null}
                    {relationship.tasks.length ? (
                      <ul className="pl-4 text-xs text-muted-foreground">
                        {relationship.tasks.map((task) => <li key={task} className="truncate" title={task}>{task}</li>)}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
