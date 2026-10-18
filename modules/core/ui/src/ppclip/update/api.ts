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

export const ppclipUpdateApi = {
  status: () => api.get<UpdateStatus>("/ppclip/update"),
  check: () => api.post<UpdateStatus>("/ppclip/update/check", {}),
  start: (force = false) => api.post<{ started: boolean }>("/ppclip/update", force ? { force } : {}),
};
