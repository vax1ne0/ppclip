import { Link } from "@/lib/router";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AiConnectionIdentity } from "@/components/ai-connections/AiConnectionIdentity";
import { AiConnectionUsagePanel } from "@/components/ai-connections/AiConnectionUsagePanel";
import { formatDateTime } from "@/lib/utils";
import { useProviderUsage, usageStatusText, type AccountUsage } from "./usage";
import { usePpclipFeature } from "../features/store";

function AccountCard({ entry }: { entry: AccountUsage }) {
  // Official's panel renders bars, limits, overage and its own error states.
  const showOfficial = entry.supported && entry.usage !== null;
  return (
    <Card className="block space-y-4 p-4" data-testid="ppclip-subscription-usage-account">
      <AiConnectionIdentity connection={entry.account} />
      {showOfficial ? (
        <AiConnectionUsagePanel account={entry.account} observation={entry.usage ?? undefined} cachedOnly />
      ) : (
        <p className="text-xs text-muted-foreground" role="status">{usageStatusText(entry)}</p>
      )}
    </Card>
  );
}

/**
 * ppclip DASH-3: account-wide usage of every connected AI account, read from
 * official Connections usage. Rendered at the bottom of the Dashboard.
 */
export function SubscriptionUsagePanel({ companyId }: { companyId: string }) {
  return usePpclipFeature("providerUsage") ? <SubscriptionUsageContent companyId={companyId} /> : null;
}

function SubscriptionUsageContent({ companyId }: { companyId: string }) {
  const usage = useProviderUsage(companyId);
  const accounts = usage.data?.accounts ?? [];
  return (
    <section className="min-w-0 space-y-3" aria-labelledby="ppclip-subscription-usage-title" data-testid="ppclip-subscription-usage">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="space-y-1">
          <h3 id="ppclip-subscription-usage-title" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Subscription usage
          </h3>
          <p className="text-xs text-muted-foreground">
            Account-wide limits reported by each connected AI account, including usage outside Paperclip. Updates every 5 minutes.
          </p>
        </div>
        <Link to="/apps" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
          Manage connections
        </Link>
      </div>
      {usage.isPending && !usage.data ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : usage.isError && !usage.data ? (
        <Card className="block p-4">
          <p className="text-sm text-muted-foreground" role="alert">Couldn’t load your AI connections. Try again later.</p>
        </Card>
      ) : accounts.length === 0 ? (
        <Card className="block p-4">
          <p className="text-sm text-muted-foreground">
            No AI accounts are connected yet. Connect Claude, ChatGPT, Grok or OpenRouter in Connections to see their limits here.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {accounts.map((entry) => <AccountCard key={`${entry.account.id}:${entry.account.grantId}`} entry={entry} />)}
          </div>
          {usage.data ? (
            <p className="text-xs text-muted-foreground">
              Checked <time className="font-mono" dateTime={usage.data.checkedAt}>{formatDateTime(usage.data.checkedAt, { includeYear: false })}</time>
              {usage.isError ? " · The last refresh failed; showing the previous values." : ""}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
