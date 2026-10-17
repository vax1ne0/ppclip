import { useMemo, useState } from "react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/lib/queryKeys";
import { Link } from "@/lib/router";
import { ProviderMark } from "./ProviderMark";
import { AI_PROVIDERS } from "@/components/ai-connections/model";
import { QuotaBar } from "@/components/QuotaBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { cn, formatDateTime } from "@/lib/utils";
import { policyInput, providerRoutingApi, type ProviderRoutingStatus, type RoutingPolicyInput } from "./api";
import {
  adapterShortLabel,
  headlineLimit,
  modeStops,
  providerForAdapter,
  providerName,
  resetLabel,
  usageStatusText,
  useProviderUsage,
  type AccountUsage,
} from "./usage";
import { providerRoutingQueryKey, useProviderRouting, useSaveProviderRouting } from "./useProviderRouting";
import { usePpclipFeatures } from "../features/store";

const THRESHOLDS = [90, 95, 100];
const STATE_LABEL = { ready: "Ready", switched: "Switched", waiting: "Waiting", blocked: "Needs attention" } as const;
const CONNECTIONS_PATH = "/apps";

/** Drops tier models for providers that are no longer included. */
function prune(policy: RoutingPolicyInput): RoutingPolicyInput {
  const included = new Set(policy.providers.map((p) => p.adapterType));
  const mode = policy.mode === "hybrid" || included.has(policy.mode) ? policy.mode : "hybrid";
  return {
    ...policy,
    mode,
    tiers: policy.tiers.map((tier) => ({
      ...tier,
      models: Object.fromEntries(Object.entries(tier.models).filter(([type, model]) => included.has(type) && model.trim())),
    })),
  };
}

function Section({ title, action, children, testId }: { title: string; action?: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <section className="space-y-3" data-testid={testId}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** One connected account: headline window as official's QuotaBar, or a short masked status. */
function AccountRow({ entry }: { entry: AccountUsage }) {
  const headline = headlineLimit(entry.usage);
  const status = usageStatusText(entry);
  return (
    <li className="flex items-start gap-3 py-3" data-testid="ppclip-provider-account">
      <ProviderMark provider={entry.account.provider} routing={entry.account.routing} size={20} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{entry.account.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{providerName(entry.account.provider)}</span>
        </div>
        {headline?.usedPercent != null ? (
          <QuotaBar
            label={headline.label}
            percentUsed={headline.usedPercent}
            leftLabel={`${Math.round(headline.usedPercent)}% used`}
            rightLabel={resetLabel(headline.resetsAt) ?? undefined}
          />
        ) : status ? <p className="text-xs text-muted-foreground">{status}</p> : null}
      </div>
    </li>
  );
}

/** A provider some agents run on, with no connected account to sign in with. */
function MissingAccountRow({ provider, agentCount }: { provider: string; agentCount: number }) {
  const meta = AI_PROVIDERS[provider as keyof typeof AI_PROVIDERS];
  return (
    <li className="flex items-center gap-3 py-3" data-testid="ppclip-provider-missing-account">
      <ProviderMark provider={provider} size={20} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{meta?.subscriptionName ?? meta?.name ?? provider}</p>
        <p className="text-xs text-muted-foreground">
          Not connected. {agentCount === 1 ? "1 agent uses" : `${agentCount} agents use`} this provider and can’t sign in until you connect an account.
        </p>
      </div>
      <Button asChild variant="outline" size="xs">
        <Link to={CONNECTIONS_PATH}>Connect</Link>
      </Button>
    </li>
  );
}

function AccountsSection({ companyId, status }: { companyId: string; status: ProviderRoutingStatus | undefined }) {
  const usage = useProviderUsage(companyId);
  const accounts = usage.data?.accounts ?? [];
  const connected = new Set(accounts.map((entry) => entry.account.provider));
  const missing = new Map<string, number>();
  for (const candidate of status?.candidates ?? []) {
    const provider = providerForAdapter(candidate.adapterType);
    if (provider && !connected.has(provider) && candidate.agents.length > 0) {
      missing.set(provider, (missing.get(provider) ?? 0) + candidate.agents.length);
    }
  }
  return (
    <Section
      title="Accounts"
      testId="ppclip-provider-accounts"
      action={<Link to={CONNECTIONS_PATH} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">Manage connections</Link>}
    >
      {usage.isPending && !usage.data ? (
        <p className="text-xs text-muted-foreground" role="status">Checking your AI accounts…</p>
      ) : usage.isError && !usage.data ? (
        <p className="text-xs text-muted-foreground" role="alert">Couldn’t load your AI accounts. Try again later.</p>
      ) : accounts.length === 0 && missing.size === 0 ? (
        <p className="text-xs text-muted-foreground">No AI accounts are connected yet. Connect Claude, ChatGPT or Grok in Connections.</p>
      ) : (
        <ul className="divide-y divide-border">
          {accounts.map((entry) => <AccountRow key={`${entry.account.id}:${entry.account.grantId}`} entry={entry} />)}
          {[...missing].map(([provider, count]) => <MissingAccountRow key={provider} provider={provider} agentCount={count} />)}
        </ul>
      )}
    </Section>
  );
}

function PolicyEditor({ companyId, status, save, before, after }: {
  companyId: string;
  status: ProviderRoutingStatus;
  save: ReturnType<typeof useSaveProviderRouting>;
  before: React.ReactNode;
  after: React.ReactNode;
}) {
  const saved = useMemo(() => policyInput(status.policy), [status.policy]);
  const [draft, setDraft] = useState<RoutingPolicyInput>(saved);
  const included = draft.providers.map((p) => p.adapterType);
  const catalogs = useQueries({
    queries: included.map((type) => ({
      queryKey: queryKeys.agents.adapterModels(companyId, type),
      queryFn: () => agentsApi.adapterModels(companyId, type),
      staleTime: 5 * 60_000,
    })),
  });

  function toggleProvider(adapterType: string, on: boolean, defaultTemplate: string | undefined) {
    setDraft((current) => {
      const providers = on
        ? defaultTemplate ? [...current.providers, { adapterType, templateAgentId: defaultTemplate }] : current.providers
        : current.providers.filter((p) => p.adapterType !== adapterType);
      return { ...current, providers };
    });
  }

  function setModel(tierIndex: number, adapterType: string, model: string) {
    setDraft((current) => ({
      ...current,
      tiers: current.tiers.map((tier, index) => (index === tierIndex ? { ...tier, models: { ...tier.models, [adapterType]: model } } : tier)),
    }));
  }

  const blank = draft.tiers.some((tier) => !tier.name.trim());
  const dirty = JSON.stringify(prune(draft)) !== JSON.stringify(prune(saved));
  return (
    <>
      <div className="flex-1 space-y-8 overflow-y-auto px-4 py-5">
        {before}
        <Section title="Automatic switching" testId="ppclip-provider-switching">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm">Move idle agents to another provider when theirs runs out</p>
              <p className="text-xs text-muted-foreground">
                Checked every minute. An agent switches only after its current work finishes and keeps its own instructions, workspace and environment.
              </p>
            </div>
            <ToggleSwitch
              aria-label="Switch agents between providers"
              data-testid="ppclip-provider-routing-enabled"
              checked={draft.enabled}
              onCheckedChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
            />
          </div>

          {draft.enabled ? (
            <div className="space-y-5 pt-1">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">Switch away at</span>
                <Select value={String(draft.thresholdPercent)} onValueChange={(value) => setDraft((current) => ({ ...current, thresholdPercent: Number(value) }))}>
                  <SelectTrigger size="sm" className="w-auto min-w-32" aria-label="Exhausted at"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {THRESHOLDS.map((value) => <SelectItem key={value} value={String(value)}>{value}% used</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {included.length >= 2 ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">Mode</span>
                  <div className="flex overflow-hidden rounded-md border border-border" role="radiogroup" aria-label="Provider mode">
                    {modeStops(included).map((stop) => (
                      <button
                        key={stop.value}
                        type="button"
                        role="radio"
                        aria-checked={draft.mode === stop.value}
                        className={cn(
                          "px-2.5 py-1 text-xs whitespace-nowrap transition-colors hover:bg-accent/40",
                          draft.mode === stop.value && "bg-accent text-foreground",
                        )}
                        onClick={() => setDraft((current) => ({ ...current, mode: stop.value }))}
                      >
                        {stop.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Providers to switch between. A switched agent copies the harness settings and AI connection of the agent you pick.
                </p>
                {status.candidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No agent uses a harness that signs in through Connections yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {status.candidates.map((candidate) => {
                      const entry = draft.providers.find((p) => p.adapterType === candidate.adapterType);
                      const label = adapterShortLabel(candidate.adapterType);
                      return (
                        <li key={candidate.adapterType} className="flex min-h-8 flex-wrap items-center justify-between gap-2">
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={Boolean(entry)}
                              disabled={!entry && candidate.agents.length === 0}
                              onCheckedChange={(checked) => toggleProvider(candidate.adapterType, checked === true, candidate.agents[0]?.id)}
                              aria-label={`Route with ${label}`}
                            />
                            <ProviderMark provider={providerForAdapter(candidate.adapterType) ?? candidate.adapterType} />
                            {label}
                          </label>
                          {entry ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">Settings from</span>
                              <Select
                                value={entry.templateAgentId}
                                onValueChange={(templateAgentId) => setDraft((current) => ({
                                  ...current,
                                  providers: current.providers.map((p) => (p.adapterType === candidate.adapterType ? { ...p, templateAgentId } : p)),
                                }))}
                              >
                                <SelectTrigger size="sm" className="w-44" aria-label={`${label} template agent`}><SelectValue placeholder="Choose an agent" /></SelectTrigger>
                                <SelectContent>
                                  {candidate.agents.map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Model tiers: each row pairs equivalent models. A switched agent gets its tier’s model on the other provider and keeps its effort setting.
                </p>
                {status.candidates.length < 2 ? (
                  <p className="text-xs text-muted-foreground">Switching needs agents on two providers. Set up an agent on another provider (for example Claude or Codex) to pair their models.</p>
                ) : included.length < 2 ? (
                  <p className="text-xs text-muted-foreground">Choose two providers above to pair their models.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" data-testid="ppclip-model-tiers">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="w-32 py-1 pr-2 font-normal">Tier</th>
                          {included.map((type) => <th key={type} className="py-1 pr-2 font-normal">{adapterShortLabel(type)}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {draft.tiers.map((tier, tierIndex) => (
                          <tr key={tier.id}>
                            <td className="py-1 pr-2">
                              <Input
                                value={tier.name}
                                aria-label={`Tier ${tierIndex + 1} name`}
                                aria-invalid={!tier.name.trim() || undefined}
                                onChange={(event) => setDraft((current) => ({
                                  ...current,
                                  tiers: current.tiers.map((t, i) => (i === tierIndex ? { ...t, name: event.target.value } : t)),
                                }))}
                              />
                            </td>
                            {included.map((type) => (
                              <td key={type} className="py-1 pr-2">
                                <Input
                                  value={tier.models[type] ?? ""}
                                  list={`ppclip-models-${type}`}
                                  placeholder="Not paired"
                                  aria-label={`${tier.name || `Tier ${tierIndex + 1}`} ${adapterShortLabel(type)} model`}
                                  className="font-mono"
                                  onChange={(event) => setModel(tierIndex, type, event.target.value)}
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {included.map((type, index) => (
                      <datalist key={type} id={`ppclip-models-${type}`}>
                        {(catalogs[index]?.data ?? []).map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                      </datalist>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </Section>
        {after}
      </div>

      <SheetFooter className="mt-auto flex-row items-center justify-between gap-3 border-t border-border">
        <div className="flex min-w-0 items-center gap-3">
          {dirty ? (
            <Button variant="ghost" size="sm" disabled={save.isPending} onClick={() => { save.reset(); setDraft(saved); }}>
              Discard
            </Button>
          ) : null}
          <p className="min-w-0 text-xs text-muted-foreground" role={save.isError ? "alert" : "status"}>
            {save.isError
              ? (save.error instanceof Error ? save.error.message : "Couldn’t save provider settings.")
              : blank ? "Every tier needs a name."
              : save.isSuccess && !dirty ? "Saved. Agents switch after their current work finishes." : ""}
          </p>
        </div>
        <Button
          size="sm"
          disabled={save.isPending || blank || !dirty}
          onClick={() => save.mutate({ revision: status.policy.revision, policy: prune(draft) })}
        >
          {save.isPending ? "Saving…" : "Save provider settings"}
        </Button>
      </SheetFooter>
    </>
  );
}

function ControllerStatus({ companyId, status }: { companyId: string; status: ProviderRoutingStatus }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: providerRoutingQueryKey(companyId) });
  const reconcile = useMutation({ mutationFn: () => providerRoutingApi.reconcile(companyId), onSettled: invalidate });
  const release = useMutation({ mutationFn: (agentId: string) => providerRoutingApi.release(companyId, agentId), onSettled: invalidate });
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const candidate of status.candidates) for (const agent of candidate.agents) map.set(agent.id, agent.name);
    for (const agent of status.routedAgents) map.set(agent.agentId, agent.name);
    return map;
  }, [status]);
  const health = status.controller.health;
  const rows = (health?.agents ?? []).filter((agent) => agent.state !== "ready");
  if (!status.policy.enabled && status.routedAgents.length === 0) return null;
  return (
    <Section
      title="Status"
      testId="ppclip-provider-controller"
      action={(
        <Button variant="outline" size="xs" disabled={reconcile.isPending} onClick={() => reconcile.mutate()}>
          {reconcile.isPending ? "Checking…" : "Check now"}
        </Button>
      )}
    >
      <p className="text-xs text-muted-foreground">
        {health ? <>Checked <time className="font-mono" dateTime={health.checkedAt}>{formatDateTime(health.checkedAt, { includeYear: false })}</time></> : "Not checked since the server started."}
        {status.policy.enabled ? "" : " · Automatic switching is off."}
      </p>
      {health?.error ? <p className="text-xs text-destructive" role="alert">{health.error}</p> : null}
      {rows.length > 0 ? (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.agentId} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="truncate">{names.get(row.agentId) ?? row.agentId}</span>
                  <Badge variant={row.state === "blocked" ? "destructive" : "outline"}>{STATE_LABEL[row.state]}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{row.message}</p>
              </div>
              {row.state === "blocked" && status.routedAgents.some((agent) => agent.agentId === row.agentId) ? (
                <Button variant="outline" size="xs" disabled={release.isPending} onClick={() => release.mutate(row.agentId)}>
                  Keep current settings
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : health ? <p className="text-xs text-muted-foreground">Every routed agent is ready.</p> : null}
    </Section>
  );
}

/** ppclip PROV-1: AI accounts and their usage, automatic provider switching, and its status. */
export function ProviderSettingsSheet({ companyId, open, onOpenChange }: { companyId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const routing = useProviderRouting(companyId);
  const save = useSaveProviderRouting(companyId);
  const features = usePpclipFeatures();
  const accounts = features.providerUsage ? <AccountsSection companyId={companyId} status={routing.data} /> : null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-xl" data-testid="ppclip-provider-settings">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle>Providers</SheetTitle>
          <SheetDescription>Your AI accounts, and whether agents may move to another provider when one runs out.</SheetDescription>
        </SheetHeader>
        {!features.providerRouting ? (
          <div className="flex-1 space-y-8 overflow-y-auto px-4 py-5">{accounts}</div>
        ) : routing.data ? (
          // Remount the editor when another window saves a new revision.
          <PolicyEditor
            key={routing.data.policy.revision}
            companyId={companyId}
            status={routing.data}
            save={save}
            before={accounts}
            after={<ControllerStatus companyId={companyId} status={routing.data} />}
          />
        ) : (
          <div className="flex-1 space-y-8 overflow-y-auto px-4 py-5">
            {accounts}
            <p className="text-sm text-muted-foreground" role={routing.isError ? "alert" : "status"}>
              {routing.isError ? "Couldn’t load provider settings." : "Loading…"}
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
