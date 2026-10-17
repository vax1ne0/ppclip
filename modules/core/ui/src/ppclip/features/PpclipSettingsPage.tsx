import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Blocks } from "lucide-react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { Card } from "@/components/ui/card";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { PPCLIP_MODULES, type PpclipFeatureInfo, type PpclipFeatureKey } from "./registry";
import { ppclipFeaturesApi, setPpclipFeatures, usePpclipFeatures } from "./store";

function FeatureToggleCard({ feature, checked, disabled, onChange }: {
  feature: PpclipFeatureInfo;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Card className="block bg-transparent p-5" data-testid={`ppclip-feature-${feature.key}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold">{feature.title}</h3>
          <p className="max-w-2xl text-sm text-muted-foreground">{feature.description}</p>
          {feature.footnote ? <p className="max-w-2xl text-xs text-muted-foreground">{feature.footnote}</p> : null}
        </div>
        <ToggleSwitch
          checked={checked}
          onCheckedChange={onChange}
          disabled={disabled}
          aria-label={`Toggle ${feature.title}`}
        />
      </div>
    </Card>
  );
}

/** Settings → ppclip: turn each ppclip module on or off for this Paperclip install. */
export function PpclipSettingsPage() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const features = usePpclipFeatures();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Settings", href: "/company/settings" },
      { label: "ppclip" },
    ]);
  }, [setBreadcrumbs]);

  const update = useMutation({
    mutationFn: (patch: Partial<Record<PpclipFeatureKey, boolean>>) => ppclipFeaturesApi.update(patch),
    onMutate: () => setError(null),
    onSuccess: setPpclipFeatures,
    onError: (err) => setError(err instanceof Error ? err.message : "Couldn’t change the ppclip module."),
  });

  return (
    <div className="max-w-6xl space-y-6" data-testid="ppclip-settings-page">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Blocks className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">ppclip</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Turn the additions from your ppclip package on or off. Everything is on by default, applies to every company on this
          install, and takes effect immediately. Turning a module off brings back official Paperclip’s own behaviour; your data is kept.
        </p>
      </div>

      {error ? (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {PPCLIP_MODULES.map((group) => (
        <section key={group.id} className="space-y-3" aria-labelledby={`ppclip-module-${group.id}`}>
          <div className="space-y-1">
            <h2 id={`ppclip-module-${group.id}`} className="text-sm font-semibold">{group.title}</h2>
            <p className="text-sm text-muted-foreground">{group.description}</p>
          </div>
          {group.features.map((feature) => (
            <FeatureToggleCard
              key={feature.key}
              feature={feature}
              checked={update.isPending && update.variables?.[feature.key] !== undefined ? update.variables[feature.key]! : features[feature.key]}
              disabled={update.isPending}
              onChange={(checked) => update.mutate({ [feature.key]: checked })}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
