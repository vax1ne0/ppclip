import http from "node:http";

/**
 * Minimal Docker Engine API client over the local socket (Linux/macOS) or the
 * Docker Desktop named pipe (Windows). No dependency: plain node:http.
 */
function defaultDockerSocket() {
  if (process.env.DOCKER_HOST?.startsWith("unix://")) return process.env.DOCKER_HOST.slice("unix://".length);
  if (process.env.DOCKER_HOST?.startsWith("npipe://")) return process.env.DOCKER_HOST.slice("npipe://".length).replace(/\//g, "\\");
  return process.platform === "win32" ? "\\\\.\\pipe\\docker_engine" : "/var/run/docker.sock";
}

export class DockerApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export class DockerApi {
  constructor(private readonly socketPath = defaultDockerSocket(), private readonly version = "v1.43") {}

  request<T = unknown>(method: string, path: string, body?: unknown, timeoutMs = 60_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const req = http.request({
        socketPath: this.socketPath,
        path: `/${this.version}${path}`,
        method,
        headers: payload ? { "content-type": "application/json", "content-length": payload.length } : {},
        timeout: timeoutMs,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          if (status >= 400) {
            let message = text;
            try { message = (JSON.parse(text) as { message?: string }).message ?? text; } catch { /* plain text */ }
            reject(new DockerApiError(status, message.trim() || `Docker API ${status}`));
            return;
          }
          if (!text) { resolve(undefined as T); return; }
          try { resolve(JSON.parse(text) as T); } catch { resolve(text as T); }
        });
      });
      req.on("timeout", () => req.destroy(new Error("Docker API timed out")));
      req.on("error", (err) => reject(new DockerApiError(0, `Cannot reach Docker (${err.message}). Is Docker running?`)));
      if (payload) req.write(payload);
      req.end();
    });
  }

  /** Ignores "already exists" (409) and "not found" (404) where the caller says so. */
  async tolerate<T>(promise: Promise<T>, statuses: number[]): Promise<T | null> {
    try {
      return await promise;
    } catch (err) {
      if (err instanceof DockerApiError && statuses.includes(err.status)) return null;
      throw err;
    }
  }
}
