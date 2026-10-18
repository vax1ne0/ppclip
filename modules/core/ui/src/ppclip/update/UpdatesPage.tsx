import { useEffect } from "react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { UpdateSection } from "./UpdateSection";

/** Updates live separately from the ppclip module switches. */
export function UpdatesPage() {
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => {
    setBreadcrumbs([{ label: "Settings", href: "/company/settings" }, { label: "Updates" }]);
  }, [setBreadcrumbs]);
  return <div className="max-w-3xl space-y-6" data-testid="ppclip-updates-page">
    <div className="space-y-2">
      <h1 className="text-lg font-semibold">Updates</h1>
      <p className="text-sm text-muted-foreground">Keep ppclip up to date.</p>
    </div>
    <UpdateSection />
  </div>;
}
