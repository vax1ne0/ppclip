import { api } from "@/api/client";

/** Mirrors server/src/ppclip/update/service.ts. */
export type UpdateJob = {
  state?: "starting" | "running" | "done" | "failed";
  step?: string;
  error?: string | null;
  from?: string;
  to?: string;
  commits?: string[];
  image?: string;
  startedAt?: string;
  finishedAt?: string | null;
};

export type UpdateStatus = {
  versions?: {
    paperclip: ProductVersion & { compatibility: "supported" | "waiting" | "unknown" };
    ppclip: ProductVersion;
  };
  localChanges?: string[];
  installation?: { installedAt: string; paperclipVersion: string } | null;
  packageDir: string | null;
  current: { commit: string; subject: string; date: string } | null;
  available: string[];
  checkedAt: string | null;
  checkError: string | null;
  blocked: string | null;
  runningRuns: number;
  job: UpdateJob | null;
  logTail: string[];
};

type ProductVersion = {
  current: string | null;
  latest: string | null;
  updateAvailable: boolean | null;
  checkFailed?: boolean;
};

export const ppclipUpdateApi = {
  progress: () => api.get<CheckProgress>("/ppclip/update/check-progress"),
  status: () => api.get<UpdateStatus>("/ppclip/update"),
  check: () => api.post<UpdateStatus>("/ppclip/update/check", {}),
  start: (force = false) => api.post<{ started: boolean }>("/ppclip/update", force ? { force } : {}),
};

export type CheckProgress = {
  id: number;
  state: "idle" | "checking" | "complete" | "failed";
  completed: number;
  total: number;
  label: string;
};
