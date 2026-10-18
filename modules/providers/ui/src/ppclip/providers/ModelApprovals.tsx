import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ModelEntry = { adapterType: string; model: string };
type Policy = { revision: number; allowedModels: ModelEntry[]; updatedAt: string; updatedBy: string };
const HARNESS_NAMES: Record<string, string> = { codex_local: "Codex", claude_local: "Claude Code", grok_local: "Grok", opencode_local: "OpenCode", gemini_local: "Gemini", pi_local: "Pi", kimi_local: "Kimi", hermes_local: "Hermes", cursor: "Cursor" };

export function ModelApprovals({ companyId }: { companyId: string }) {
  const query = useQuery({ queryKey: ["ppclip", "model-policy", companyId], queryFn: () => api.get<Policy>(`/companies/${companyId}/ppclip/model-policy`), staleTime: 30_000, refetchOnWindowFocus: false });
  if (!query.data?.allowedModels) return <section className="space-y-2"><h3 className="text-sm font-medium">Approved models</h3>
    <p className="text-xs text-muted-foreground" role={query.isError ? "alert" : "status"}>{query.isError ? "Couldn’t load model approvals." : "Loading model approvals…"}</p>
    {query.isError && <Button type="button" variant="outline" size="xs" onClick={() => void query.refetch()}>Retry</Button>}</section>;
  return <ModelApprovalEditor key={`${companyId}:${query.data.revision}`} companyId={companyId} policy={query.data} />;
}

function ModelApprovalEditor({ companyId, policy }: { companyId: string; policy: Policy }) {
  const id = useId();
  const client = useQueryClient();
  const [entries, setEntries] = useState(policy.allowedModels);
  const [adapterType, setAdapterType] = useState("codex_local");
  const [model, setModel] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const dirty = JSON.stringify(entries) !== JSON.stringify(policy.allowedModels);
  const save = useMutation({ mutationFn: () => api.put<Policy>(`/companies/${companyId}/ppclip/model-policy`, { expectedRevision: policy.revision, policy: { allowedModels: entries } }),
    onSuccess: data => client.setQueryData(["ppclip", "model-policy", companyId], data) });
  function add() {
    const trimmed = model.trim();
    if (!trimmed || /^(auto|default)$/i.test(trimmed)) { setInputError("Enter an explicit model ID."); return; }
    if (entries.some(entry => entry.adapterType === adapterType && entry.model === trimmed)) { setInputError("That model is already approved."); return; }
    setEntries([...entries, { adapterType, model: trimmed }]); setModel(""); setInputError(null);
  }
  return <section className="space-y-3" aria-labelledby={id} data-testid="ppclip-model-approvals">
    <h3 id={id} className="text-sm font-medium">Approved models</h3>
    <p className="text-xs leading-relaxed text-muted-foreground">Model-based agents must select one of these models. Task overrides, retries and automatic provider switching follow the same list. Removing every model blocks new runs.</p>
    {entries.length ? <ul className="divide-y divide-border">{entries.map(entry => <li key={`${entry.adapterType}:${entry.model}`} className="flex min-w-0 items-center gap-3 py-2">
      <div className="min-w-0 flex-1"><p className="truncate text-xs" title={entry.model}>{entry.model}</p><p className="text-xs text-muted-foreground">{HARNESS_NAMES[entry.adapterType] ?? entry.adapterType}</p></div>
      <Button type="button" size="xs" variant="ghost" disabled={save.isPending} aria-label={`Remove approval for ${entry.model} (${entry.adapterType})`} onClick={() => setEntries(entries.filter(item => item !== entry))}>Remove</Button>
    </li>)}</ul> : <p className="text-xs text-muted-foreground" role="status">No models approved. Model-based agents cannot start new runs.</p>}
    <div className="flex flex-wrap items-end gap-2">
      <label className="space-y-1 text-xs">Harness<select className="block h-8 rounded-md border border-border bg-background px-2 text-xs" value={adapterType} disabled={save.isPending} onChange={event => setAdapterType(event.target.value)}>{Object.entries(HARNESS_NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="min-w-0 flex-1 space-y-1 text-xs">Model ID<Input value={model} disabled={save.isPending} maxLength={200} className="h-8" placeholder="Enter exact model ID" onChange={event => setModel(event.target.value)} /></label>
      <Button type="button" size="xs" variant="outline" disabled={save.isPending || entries.length >= 200} onClick={add}>Add model</Button>
    </div>
    {inputError && <p role="alert" className="text-xs text-destructive">{inputError}</p>}
    {save.isError && <div role="alert" className="space-y-2"><p className="text-xs text-destructive">{save.error instanceof Error ? save.error.message : "Couldn’t save model approvals."}</p><Button type="button" size="xs" variant="outline" onClick={() => void client.invalidateQueries({ queryKey: ["ppclip", "model-policy", companyId] })}>Reload approvals</Button></div>}
    {dirty && <div className="flex items-center gap-2"><Button type="button" size="xs" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save model approvals"}</Button><Button type="button" size="xs" variant="ghost" disabled={save.isPending} onClick={() => { setEntries(policy.allowedModels); save.reset(); }}>Discard</Button></div>}
    {!dirty && policy.updatedAt && <p className="text-xs text-muted-foreground">Saved {new Date(policy.updatedAt).toLocaleString()}</p>}
  </section>;
}
