import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, ChevronDown, Download, FileCode2, GitCommitHorizontal, History, RefreshCw, Terminal } from "lucide-react";
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
  const [elapsed, setElapsed] = useState(0);
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

  // Resume progress when settings is reopened during an update.
  useEffect(() => {
    if (!updating && (job?.state === "starting" || job?.state === "running")) {
      startedAt.current = Date.parse(job.startedAt ?? "") || Date.now();
      setUpdating(true);
    }
  }, [job?.state, job?.startedAt, updating]);
  useEffect(() => {
    if (!updating) return;
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - (startedAt.current ?? Date.now())) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [updating]);

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
  const needsAttention = Boolean(data?.checkError || check.isError || status.isError);
  const busy = updating || start.isPending || check.isPending || status.isLoading;
  const statusLabel = updating || start.isPending ? "Updating…" : check.isPending ? "Checking…" : status.isLoading ? "Loading…" : needsAttention ? "Status unavailable" : !data?.checkedAt ? "Not checked yet" : available.length ? "Out of date" : "Up to date";
  const StatusIcon = updating || check.isPending || status.isLoading ? RefreshCw : needsAttention ? AlertCircle : data?.checkedAt && !available.length ? CheckCircle2 : Download;
  return (
    <section className="space-y-3" aria-labelledby="ppclip-updates" data-testid="ppclip-update-section">
      <div className="space-y-1">
        <h2 id="ppclip-updates" className="text-sm font-semibold">Updates</h2>
      </div>
      <Card className="block min-w-0 overflow-hidden bg-transparent p-0 break-words shadow-none">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <StatusIcon aria-hidden className={`mt-0.5 size-4 shrink-0 ${updating || check.isPending ? "motion-safe:animate-spin" : ""} ${needsAttention ? "text-muted-foreground" : "text-foreground"}`} />
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm font-semibold" data-testid="ppclip-update-status" aria-live="polite">{statusLabel}{!busy && !needsAttention && available.length > 0 ? <span className="ms-2 text-xs font-normal text-muted-foreground">{available.length} update{available.length === 1 ? "" : "s"} available</span> : null}</h3>
              <p className="text-xs text-muted-foreground">{data?.checkedAt ? `Last checked ${Number.isNaN(Date.parse(data.checkedAt)) ? data.checkedAt : new Date(data.checkedAt).toLocaleString()}` : "Updates apply to this Paperclip installation."}</p>
            </div>
          </div>
          {!updating ? (<div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" disabled={check.isPending || start.isPending || status.isLoading} onClick={() => check.mutate()} data-testid="ppclip-update-check">
                <RefreshCw aria-hidden className={check.isPending ? "motion-safe:animate-spin" : ""} />
                {check.isPending ? "Checking…" : "Check for updates"}
              </Button>
              {available.length && !data?.blocked && !data?.checkError ? (
                <Button type="button" size="sm" disabled={start.isPending || check.isPending} onClick={confirmAndStart} data-testid="ppclip-update-start">
                  <Download aria-hidden />
                  Update and restart
                </Button>
              ) : null}
            </div>) : <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{Math.floor(elapsed / 60)}m {elapsed % 60}s</span>}
        </div>
        {busy ? <progress aria-label={updating || start.isPending ? "Updating ppclip" : "Checking for updates"} className="block h-1.5 w-full accent-primary" /> : null}
        {data?.blocked && !updating ? <p className="flex items-start gap-2 px-4 pb-3 text-xs leading-relaxed text-muted-foreground" data-testid="ppclip-update-blocked"><AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" /><span>{data.localChanges?.length ? "Local edits need review before installing updates." : data.blocked}</span></p> : null}
        {updating ? (
          <div role="status" aria-live="polite" className="space-y-2 px-4 pb-3" data-testid="ppclip-update-progress">
            <p className="text-sm font-medium text-foreground">
              {status.isError || !job ? "Restarting Paperclip…" : job.state === "done" ? "Updated. Reloading…" : `${job.step ?? "Updating"}…`}
            </p>
            <p className="text-xs text-muted-foreground">Keep this page open. It reloads when the update finishes. Elapsed: {Math.floor(elapsed / 60)}m {elapsed % 60}s.</p>
            {elapsed >= 180 ? <p className="text-sm text-muted-foreground">This is taking longer than usual. Dependencies and image builds can take several minutes. If Paperclip does not return, inspect ppclip-update.log and server.stderr.log in your data folder, then run scripts/ppclip/start-local.mjs with your usual options.</p> : null}
          </div>
        ) : null}

        <details className="group/details border-t border-border">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <span>Version, changes & logs</span>
            <span className="flex items-center gap-2"><span className="font-mono">{data?.current?.commit}</span><ChevronDown aria-hidden className="size-3.5 group-open/details:rotate-180" /></span>
          </summary>
        <div className="space-y-3 border-t border-border p-4">
        {status.isLoading ? <p className="text-sm text-muted-foreground" role="status">Loading…</p> : null}
        {status.isError && !updating ? <div role="alert" className="space-y-2 text-sm">
          <p className="text-destructive">Could not load update status. Check that Paperclip is running, then try again.</p>
          <Button size="sm" variant="outline" onClick={() => void status.refetch()}>Retry connection</Button>
        </div> : null}
        {data?.current ? (
          <div className="space-y-3" data-testid="ppclip-update-current">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><GitCommitHorizontal className="size-4" aria-hidden />Package revision</span>
              <code className="rounded-md border border-border bg-muted/50 px-2 py-1 text-foreground">{data.current.commit}</code>{" "}
              {data.current.date ? <span>{shortDate(data.current.date)}</span> : null}
            </div>
            <p className="max-w-prose text-sm font-medium leading-relaxed">{data.current.subject}</p>
            {data?.installation ? <p className="text-xs leading-relaxed text-muted-foreground">Overlay applied {shortDate(data.installation.installedAt)} <span className="mx-1" aria-hidden>·</span> Paperclip <span className="font-mono">{data.installation.paperclipVersion}</span></p> : null}
          </div>
        ) : null}

        {!updating ? (
          <>
            {job?.state === "failed" ? (
              <p className="text-sm text-destructive" role="alert" data-testid="ppclip-update-failed">Last update failed: {job.error}</p>
            ) : job?.state === "done" && job.commits?.length ? (
              <p className="text-xs text-muted-foreground" data-testid="ppclip-update-last">
                Last update brought {job.commits.length} change{job.commits.length === 1 ? "" : "s"}{job.image ? `; computer image ${job.image}` : ""}.
              </p>
            ) : null}
            {data?.checkError ? <p className="text-sm leading-relaxed text-destructive" role="alert">Couldn't check for updates: {data.checkError}</p> : null}
            {data?.checkedAt && !data.checkError ? (
              available.length ? (
                <div className="space-y-3 border-t border-border pt-4" data-testid="ppclip-update-available">
                  <p className="text-sm text-foreground">{available.length} update{available.length === 1 ? "" : "s"} available:</p>
                  <ul className="max-h-60 list-disc space-y-2 overflow-auto ps-5 text-sm text-muted-foreground">
                    {available.slice(0, 12).map((line) => <li key={line}>{line}</li>)}
                    {available.length > 12 ? <li>and {available.length - 12} more</li> : null}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="ppclip-update-none">{data?.localChanges?.length ? "No new upstream commits. Your package includes local changes." : "ppclip is up to date."}</p>
              )
            ) : null}
            {!data?.checkedAt && !status.isLoading ? <p className="text-sm text-muted-foreground">Check for updates to see what is available.</p> : null}

            {data?.runningRuns ? <p className="text-sm text-muted-foreground">{data.runningRuns} active agent run{data.runningRuns === 1 ? "" : "s"} will be interrupted by a restart.</p> : null}
            {check.isError || start.isError ? (
              <p className="text-sm leading-relaxed text-destructive" role="alert">{((check.error ?? start.error) as Error | null)?.message ?? "That didn't work."}</p>
            ) : null}
          </>
        ) : null}
        </div>
        <div className="divide-y divide-border border-t border-border">
        {data?.localChanges?.length ? <details className="group text-sm">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-3 px-4 py-2 font-medium transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px] [&::-webkit-details-marker]:hidden"><FileCode2 aria-hidden className="size-4 text-muted-foreground" /><span className="flex-1">Local changes ({data.localChanges.length})</span><ChevronDown aria-hidden className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" /></summary>
          <div className="space-y-3 px-4 pb-4">
          <p className="mt-2 text-xs text-muted-foreground">Tracked edits pause updates. Untracked files are listed for review. Commit or stash work you want to keep; do not discard changes just to enable an update.</p>
          <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs">{data.localChanges.join("\n")}</pre>
        </div></details> : null}
        {job ? <details className="group text-sm">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-3 px-4 py-2 font-medium transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px] [&::-webkit-details-marker]:hidden"><History aria-hidden className="size-4 text-muted-foreground" /><span className="flex-1">Last update details</span><span className="text-xs font-normal capitalize text-muted-foreground">{job.state}</span><ChevronDown aria-hidden className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" /></summary>
          <div className="space-y-3 px-4 pb-4">
          <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
            <div><dt className="inline font-medium">Result: </dt><dd className="inline">{job.state ?? "Unknown"} · {job.step}</dd></div>
            {job.finishedAt ? <div><dt className="inline font-medium">Finished: </dt><dd className="inline">{new Date(job.finishedAt).toLocaleString()}</dd></div> : null}
            {job.from && job.to ? <div><dt className="inline font-medium">Revision: </dt><dd className="inline font-mono">{job.from.slice(0, 9)} → {job.to.slice(0, 9)}</dd></div> : null}
            {job.image ? <div><dt className="inline font-medium">Computer image: </dt><dd className="inline">{job.image}</dd></div> : null}
          </dl>
          {job.commits?.length ? <ul className="mt-2 list-disc space-y-1 ps-5 text-xs text-muted-foreground">{job.commits.map(line => <li key={line}>{line}</li>)}</ul> : null}
        </div></details> : null}
        <details className="group text-sm">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-3 px-4 py-2 font-medium transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px] [&::-webkit-details-marker]:hidden"><Terminal aria-hidden className="size-4 text-muted-foreground" /><span className="flex-1">Update log and location</span><ChevronDown aria-hidden className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" /></summary>
          <div className="space-y-3 px-4 pb-4">
          <p className="mt-2 text-xs text-muted-foreground">Package: <span className="break-all">{data?.packageDir ?? "Not found"}</span></p>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{data?.logTail.length ? data.logTail.join("\n") : "No update log yet."}</pre>
        </div></details>
        </div>
        </details>
      </Card>
    </section>
  );
}
