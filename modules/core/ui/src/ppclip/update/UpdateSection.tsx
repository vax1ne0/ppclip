import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, CheckCircle2, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ppclipUpdateApi, type UpdateStatus } from "./api";

const statusKey = ["ppclip", "update"] as const;
const POLL_IDLE_MS = 30_000;
const POLL_UPDATING_MS = 2_000;

/** Translate updater steps without exposing package managers, paths or raw errors. */
function progressLabel(step?: string) {
  if (step === "Downloading the new ppclip") return "Downloading update…";
  if (step === "Installing ppclip" || step === "Installing dependencies") return "Installing update…";
  if (step === "Starting Paperclip" || step === "Waiting for Paperclip to stop") return "Restarting Paperclip…";
  return "Preparing update…";
}

function checkedLabel(value?: string | null) {
  if (!value || Number.isNaN(Date.parse(value))) return "Check for the latest version of ppclip.";
  return "Last checked " + new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function VersionRow({ name, item, compatibility }: {
  name: string;
  item: NonNullable<UpdateStatus["versions"]>["ppclip"];
  compatibility?: "supported" | "waiting" | "unknown";
}) {
  const newer = item.updateAvailable;
  const label = item.checkFailed ? "Couldn’t check" : newer
    ? compatibility === "waiting" ? "Waiting for ppclip support" : compatibility === "unknown" ? "Support not confirmed" : "Update available"
    : item.updateAvailable === null ? "Not checked" : "Up to date";
  return <div className="flex items-start gap-3 py-2">
    <dt className="w-16 shrink-0 text-xs font-medium">{name}</dt>
    <dd className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex min-w-0 flex-wrap items-center gap-2 tabular-nums">
        <span>{item.current ?? "Version unavailable"}</span>
        {newer && item.latest && <><ArrowRight className="size-3" aria-label="New version" /><span className="text-foreground">{item.latest}</span></>}
      </span>
      <span>{label}</span>
    </dd>
  </div>;
}

/** Compact Settings → ppclip updates. Diagnostics stay in the updater's records. */
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

  const paperclip = data?.versions?.paperclip;
  const paperclipUpgrade = paperclip?.updateAvailable && paperclip.compatibility === "supported";
  const available = Boolean(data?.available.length || paperclipUpgrade);
  const needsAttention = Boolean(data?.checkError || check.isError || status.isError);
  const busy = updating || start.isPending || check.isPending || status.isLoading;
  const statusLabel = updating || start.isPending ? "Updating…" : check.isPending ? "Checking…" : status.isLoading ? "Loading…" : needsAttention ? "Couldn’t check for updates" : !data?.checkedAt ? "Check for updates" : available ? "Update available" : paperclip?.updateAvailable ? "No compatible updates" : "Up to date";
  const StatusIcon = busy ? RefreshCw : needsAttention ? AlertCircle : data?.checkedAt && !available ? CheckCircle2 : Download;
  return (
    <section className="space-y-3" aria-labelledby="ppclip-updates" data-testid="ppclip-update-section">
      <h2 id="ppclip-updates" className="text-sm font-semibold">Updates</h2>
      <Card className="block min-w-0 overflow-hidden bg-transparent p-0 shadow-none">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <StatusIcon aria-hidden className={"mt-0.5 size-4 shrink-0 " + (busy ? "motion-safe:animate-spin " : "") + (needsAttention ? "text-muted-foreground" : "text-foreground")} />
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm font-semibold" data-testid="ppclip-update-status" aria-live="polite">{statusLabel}</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">{needsAttention ? "Check your connection and try again." : !busy && available ? "A new version of ppclip is ready to install." : checkedLabel(data?.checkedAt)}</p>
            </div>
          </div>
          {!updating && <div className="flex shrink-0 flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => check.mutate()} data-testid="ppclip-update-check">
              <RefreshCw aria-hidden className={check.isPending ? "motion-safe:animate-spin" : ""} />
              {check.isPending ? "Checking…" : "Check for updates"}
            </Button>
            {available && !data?.blocked && !needsAttention && <Button type="button" size="sm" disabled={busy} onClick={confirmAndStart} data-testid="ppclip-update-start"><Download aria-hidden />Update and restart</Button>}
          </div>}
        </div>
        {busy && <progress aria-label={updating || start.isPending ? "Updating ppclip" : "Checking for updates"} className="block h-1.5 w-full accent-primary" />}
        {data?.versions && <dl className="divide-y divide-border border-t border-border px-4 py-1" aria-label="Installed and available versions" data-testid="ppclip-update-versions">
          <VersionRow name="Paperclip" item={data.versions.paperclip} compatibility={data.versions.paperclip.compatibility} />
          <VersionRow name="ppclip" item={data.versions.ppclip} />
        </dl>}
        {!busy && available && data?.blocked && <p className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground" data-testid="ppclip-update-blocked">Automatic updates aren’t available right now. Contact the person who set up this installation to help update it.</p>}
        {updating && <div role="status" aria-live="polite" className="space-y-2 px-5 pb-5" data-testid="ppclip-update-progress">
          <p className="text-sm font-medium">{status.isError || !job ? "Restarting Paperclip…" : job.state === "done" ? "Updated. Reloading…" : progressLabel(job.step)}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">Keep this page open. It will reload when the update finishes. <span className="tabular-nums">{Math.floor(elapsed / 60)}m {elapsed % 60}s</span></p>
          {elapsed >= 180 && <p className="text-sm text-muted-foreground">This is taking longer than usual. If the page doesn’t return, ask the person who set up this installation for help.</p>}
        </div>}
        {!updating && (start.isError || job?.state === "failed") && <p role="alert" className="px-5 pb-5 text-sm text-destructive" data-testid="ppclip-update-failed">The update couldn’t finish. {data?.blocked ? "Contact the person who set up this installation for help." : "Check for updates and try again."}</p>}
        {!busy && available && !data?.blocked && !needsAttention && <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-muted-foreground">Paperclip will restart during installation.{data?.runningRuns ? (" " + data.runningRuns + " active agent run" + (data.runningRuns === 1 ? " will" : "s will") + " be interrupted.") : " This usually takes about a minute."}</p>}
      </Card>
    </section>
  );
}
