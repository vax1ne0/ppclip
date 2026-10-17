import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { providerRoutingApi, policyInput, type ProviderRoutingStatus, type RoutingPolicyInput } from "./api";
import { usePpclipFeature } from "../features/store";

export const providerRoutingQueryKey = (companyId: string) => ["ppclip", "provider-routing", companyId] as const;

export function useProviderRouting(companyId: string | null | undefined) {
  const routingOn = usePpclipFeature("providerRouting");
  return useQuery({
    queryKey: providerRoutingQueryKey(companyId ?? ""),
    queryFn: () => providerRoutingApi.status(companyId!),
    enabled: !!companyId && routingOn,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}

/** Saves a policy change against the revision the screen loaded; the server rejects stale saves. */
export function useSaveProviderRouting(companyId: string) {
  const queryClient = useQueryClient();
  const key = providerRoutingQueryKey(companyId);
  return useMutation({
    mutationFn: ({ revision, policy }: { revision: number; policy: RoutingPolicyInput }) =>
      providerRoutingApi.save(companyId, revision, policy),
    onSuccess: (status) => queryClient.setQueryData<ProviderRoutingStatus>(key, status),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** Switch mode only: keeps everything else from the loaded policy. */
export function useSetRoutingMode(companyId: string) {
  const save = useSaveProviderRouting(companyId);
  const queryClient = useQueryClient();
  return {
    ...save,
    setMode: (mode: string) => {
      const status = queryClient.getQueryData<ProviderRoutingStatus>(providerRoutingQueryKey(companyId));
      if (!status) return;
      save.mutate({ revision: status.policy.revision, policy: { ...policyInput(status.policy), mode } });
    },
  };
}
