import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ppclipUpdateApi, type UpdateStatus } from "./api";

const statusKey = ["ppclip", "update"] as const;

/** While an update runs the server goes away; poll fast and treat errors as "restarting". */
const POLL_IDLE_MS = 30_000;
const POLL_UPDATING_MS = 2_000;

function shortDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

/**
 * Settings → ppclip → Updates: check the ppclip repo for new commits and
 * update with one click. Paperclip restarts (about a minute); the page reloads
 * itself when it is back.
 */
export function UpdateSection() {
  const queryClient = useQueryClient();
  const [updating, setUpdating] = useState(false);
  const startedAt = useRef<number | null>(null);
  const status = useQuery({
    queryKey: statusKey,
    queryFn: ppclipUpdateApi.status,
    refetchInterval: updating ? POLL_UPDATING_MS : POLL_IDLE_MS,
    retry: updating ? false : 1,
  });
  const check = useMutation({
    mutationFn: ppclipUpdateApi.check,
    onSuccess: (data) => queryClient.setQueryData(statusKey, data),
  });
  const start = useMutation({
    mutationFn: () => ppclipUpdateApi.start(),
    onSuccess: () => {
      startedAt.current = Date.now();
      setUpdating(true);
    },
  });

  const data: UpdateStatus | undefined = status.data;
  const job = data?.job;
  const finishedThisTime = updating && job?.finishedAt && startedAt.current !== null && Date.parse(job.finishedAt) >= startedAt.current - 5_000;

  // Back up after an update: reload so the new ppclip UI is used.
  useEffect(() => {
    if (finishedThisTime && job?.state === "done") {
      const timer = window.setTimeout(() => window.location.reload(), 1500);
      return () => window.clearTimeout(timer);
    }
    if (finishedThisTime && job?.state === "failed") setUpdating(false);
    return undefined;
  }, [finishedThisTime, job?.state]);

  function confirmAndStart() {
    const runs = data?.runningRuns ?? 0;
    const message = [
      "Update ppclip and restart Paperclip?",
      "Paperclip will be unavailable for about a minute (longer if dependencies change), and this page reloads by itself.",
      runs ? `${runs} agent run${runs === 1 ? " is" : "s are"} running now and will be interrupted.` : null,
    ].filter(Boolean).join("\n\n");
    if (window.confirm(message)) start.mutate();
  }

  const available = data?.available ?? [];
  return (
    <section className="space-y-3" aria-labelledby="ppclip-updates" data-testid="ppclip-update-section">
      <div className="space-y-1">
        <h2 id="ppclip-updates" className="text-sm font-semibold">Updates</h2>
        <p className="text-sm text-muted-foreground">Get the newest ppclip from its GitHub repository. Paperclip restarts once to apply it.</p>
      </div>
      <Card className="block space-y-3 bg-transparent p-5">
        {status.isLoading ? <p className="text-sm text-muted-foreground" role="status">Loading…</p> : null}
        {data?.current ? (
          <p className="text-sm text-foreground" data-testid="ppclip-update-current">
            Installed: <span className="font-mono text-xs">{data.current.commit}</span> {data.current.subject}
            {data.current.date ? <span className="text-muted-foreground"> ({shortDate(data.current.date)})</span> : null}
          </p>
        ) : null}

        {updating ? (
          <div role="status" aria-live="polite" className="space-y-1" data-testid="ppclip-update-progress">
            <p className="text-sm font-medium text-foreground">
              {status.isError || !job ? "Restarting Paperclip…" : job.state === "done" ? "Updated. Reloading…" : `${job.step ?? "Updating"}…`}
            </p>
            <p className="text-xs text-muted-foreground">Keep this page open. It reloads when Paperclip is back.</p>
          </div>
        ) : (
          <>
            {job?.state === "failed" ? (
              <p className="text-sm text-destructive" role="alert" data-testid="ppclip-update-failed">Last update failed: {job.error}</p>
            ) : job?.state === "done" && job.commits?.length ? (
              <p className="text-xs text-muted-foreground" data-testid="ppclip-update-last">
                Last update brought {job.commits.length} change{job.commits.length === 1 ? "" : "s"}{job.image ? `; computer image ${job.image}` : ""}.
              </p>
            ) : null}
            {data?.checkError ? <p className="text-xs text-destructive" role="alert">Couldn't check for updates: {data.checkError}</p> : null}
            {data?.checkedAt && !data.checkError ? (
              available.length ? (
                <div className="space-y-1" data-testid="ppclip-update-available">
                  <p className="text-sm text-foreground">{available.length} update{available.length === 1 ? "" : "s"} available:</p>
                  <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                    {available.slice(0, 12).map((line) => <li key={line}>{line}</li>)}
                    {available.length > 12 ? <li>and {available.length - 12} more</li> : null}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="ppclip-update-none">ppclip is up to date.</p>
              )
            ) : null}
            {data?.blocked ? <p className="text-xs text-muted-foreground" data-testid="ppclip-update-blocked">{data.blocked}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" disabled={check.isPending} onClick={() => check.mutate()} data-testid="ppclip-update-check">
                <RefreshCw aria-hidden />
                {check.isPending ? "Checking…" : "Check for updates"}
              </Button>
              {available.length && !data?.blocked ? (
                <Button type="button" size="sm" disabled={start.isPending} onClick={confirmAndStart} data-testid="ppclip-update-start">
                  <Download aria-hidden />
                  Update and restart
                </Button>
              ) : null}
            </div>
            {check.isError || start.isError ? (
              <p className="text-xs text-destructive" role="alert">{((check.error ?? start.error) as Error | null)?.message ?? "That didn't work."}</p>
            ) : null}
          </>
        )}
      </Card>
    </section>
  );
}
