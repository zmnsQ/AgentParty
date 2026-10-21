import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import worker, { type AppEnv } from "../src/index";

/**
 * Real Worker middleware and local D1/DO/R2, in the test's I/O context.
 * SELF.fetch uses a different request context: a deferred mock reply resumed by
 * another test request must not transfer its streams across that boundary.
 * Sequential integration cases continue to use SELF.fetch via helpers.ts.
 */
export async function concurrentApi(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`http://ap.test${path}`, {
    ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  }), env as AppEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}
