import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import worker, { type AppEnv } from "../src/index";

/** Handler-level fault injection with real D1/DO/R2, in the test request context.
 * Cross-request promise gates through SELF can deadlock the workerd RPC bridge.
 * Keep ordinary HTTP integration cases on SELF; only controlled races use this.
 */
export async function handlerApi(path: string, token: string, init: RequestInit = {}, db: D1Database = env.DB): Promise<Response> {
  const context = createExecutionContext();
  const response = await worker.fetch(new Request(`http://ap.test${path}`, {
    ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  }), { ...env, DB: db } as AppEnv, context);
  await waitOnExecutionContext(context);
  return response;
}

/** Intercept exactly one real D1 statement to control a race or storage fault. */
export function statementHook(db: D1Database, contains: string, method: "first" | "run", hook: () => Promise<void>, timing: "before" | "after" = "after"): D1Database {
  let fired = false;
  const statement = (target: D1PreparedStatement, sql: string): D1PreparedStatement => new Proxy(target, {
    get(target, key) {
      if (key === "bind") return (...values: unknown[]) => statement(target.bind(...values), sql);
      const value = Reflect.get(target, key, target);
      if (key === method) return async (...args: unknown[]) => {
        const selected = !fired && sql.includes(contains);
        if (selected) { fired = true; if (timing === "before") await hook(); }
        const result = await Reflect.apply(value, target, args);
        if (selected && timing === "after") await hook();
        return result;
      };
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy(db, {
    get(target, key) {
      if (key === "prepare") return (sql: string) => statement(target.prepare(sql), sql);
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
