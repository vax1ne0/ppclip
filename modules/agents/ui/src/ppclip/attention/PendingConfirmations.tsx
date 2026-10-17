import { useMemo, useState } from "react";
import { MessageSquareMore } from "lucide-react";
import type { AttentionItem } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { relativeTime } from "@/lib/utils";
import { splitPendingConfirmations } from "./agent-attention";
import { useAttentionFeed } from "./useAgentAttention";
import { usePpclipFeature } from "@/ppclip/features/store";

function CardRow({ item, onNavigate }: { item: AttentionItem; onNavigate: () => void }) {
  const from = item.resolverAudience?.createdByAgentName ?? item.originAgentName;
  const task = item.relatedIssue;
  const body = (
    <>
      <span className="truncate text-sm font-medium">{item.subject.title ?? "Confirmation"}</span>
      <span className="truncate text-xs text-muted-foreground">
        {[task ? `${task.identifier ?? "Task"} · ${task.title ?? ""}` : null, from ? `from ${from}` : null]
          .filter(Boolean)
          .join(" — ")}
      </span>
      <span className="text-(length:--text-micro) text-muted-foreground/70">{relativeTime(item.activityAt)}</span>
    </>
  );
  const className = "flex min-w-0 flex-col gap-0.5 rounded-md px-2 py-2 text-left no-underline text-inherit transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
  return (
    <li>
      {item.subject.href ? (
        <Link to={item.subject.href} className={className} onClick={onNavigate}>{body}</Link>
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
  );
}

function Group({ title, items, onNavigate }: { title: string; items: AttentionItem[]; onNavigate: () => void }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <p className="px-2 text-(length:--text-micro) font-medium uppercase tracking-widest text-muted-foreground">
        {title} <span className="font-mono">{items.length}</span>
      </p>
      {items.length === 0 ? (
        <p className="px-2 pb-1 text-xs text-muted-foreground">Nothing here.</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((item) => <CardRow key={item.id} item={item} onNavigate={onNavigate} />)}
        </ul>
      )}
    </section>
  );
}

/**
 * ppclip NAV-2: open confirmation / question cards across all tasks, split by
 * who can answer. Reads official's attention feed (the Decisions data); each
 * row links to the card on its task, where official's resolver handles it.
 */
/** ppclip module switch (Settings → ppclip): attention. */
export function PendingConfirmations(props: Parameters<typeof PendingConfirmationsContent>[0]) {
  return usePpclipFeature("attention") ? <PendingConfirmationsContent {...props} /> : null;
}

function PendingConfirmationsContent({ companyId }: { companyId: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  const feed = useAttentionFeed(companyId);
  const groups = useMemo(() => splitPendingConfirmations(feed.data?.items ?? []), [feed.data]);
  if (!companyId || !feed.data) return null;
  const total = groups.humanOnly.length + groups.shared.length;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`Pending confirmations: ${total}`}
          title="Pending confirmations"
        >
          <MessageSquareMore className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Pending</span>
          <span className="font-mono text-xs text-muted-foreground">{total}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex max-h-(--sz-28rem) w-80 flex-col gap-3 overflow-y-auto p-2">
        <p className="px-2 pt-1 text-sm font-medium">Pending confirmations</p>
        <Group title="Needs your response" items={groups.humanOnly} onNavigate={() => setOpen(false)} />
        <Group title="You or a teammate can respond" items={groups.shared} onNavigate={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
