import { ProviderError } from "./provider.js";

/** Retry only idempotent screen reads. Control actions are never replayed. */
export async function readScreenFile(url: () => string | Promise<string>, attempts = 3) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    // Authorization, lease and provider errors are not screen transport errors.
    const target = await url();
    try {
      const response = await fetch(target, { signal: AbortSignal.timeout(3000) });
      if (response.status >= 500) {
        await response.body?.cancel();
        throw new Error("Screen service is not ready");
      }
      // Buffer before sending headers: a reset during the body is retryable too.
      const body = Buffer.from(await response.arrayBuffer());
      return { status: response.status, contentType: response.headers.get("content-type") ?? "application/octet-stream", body };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw new ProviderError("unavailable", "The live screen is temporarily unavailable. Reconnect the live view to try again.", 502);
}
