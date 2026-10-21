import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { agentpartyHome } from "../cli/src/config";
import { autoUpgradeDisabled } from "../cli/src/auto-upgrade";
import { OWNER_REPO } from "../cli/src/upgrade";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("independent fork defaults", () => {
  test("the default Worker cannot deploy into upstream resources or shut down on its date", () => {
    const config = JSON.parse(read("worker/wrangler.jsonc").replace(/^\s*\/\/.*$/gm, ""));
    expect(config.name).toBe("agentparty-commons");
    expect(config.vars.AGENTPARTY_SHUTDOWN_AT).toBe("");
    expect(config.vars.HOSTED_MEMBERSHIP_GATING).toBe("false");
    expect(config.vars.COLLABORATION_HERMES_ALLOWED_ORIGINS).toBe("[]");
    expect(config.routes).toBeUndefined();
    expect(config.d1_databases[0].database_id).toBe("00000000-0000-0000-0000-000000000000");
    expect(config.r2_buckets[0].bucket_name).toBe("agentparty-commons-attachments");
  });

  test("desktop identity and CLI state cannot silently overwrite the upstream installation", () => {
    const config = JSON.parse(read("desktop/src-tauri/tauri.conf.json"));
    expect(config.identifier).toBe("com.zmns.agentpartycommons");
    expect(config.plugins["deep-link"].desktop.schemes).toEqual(["agentparty-commons"]);
    expect(config.bundle.createUpdaterArtifacts).toBe(false);
    expect(config.plugins.updater).toBeUndefined();
    expect(agentpartyHome({}, "/tmp/example-user")).toBe("/tmp/example-user/.agentparty-commons");
    expect(OWNER_REPO).toBe("zmnsQ/AgentParty");
    expect(autoUpgradeDisabled({}, false)).toBe(true);
    expect(read("web/src/main.tsx")).not.toContain("<OcsMigrationNotice");
  });

  test("the fork runs only bounded manual workflows without deployment or messaging permissions", () => {
    const files = readdirSync(resolve(root, ".github/workflows")).filter((path) => /\.ya?ml$/.test(path));
    expect(files.sort()).toEqual(["commons-check.yml", "commons-desktop.yml"]);
    for (const name of files) {
      const workflow = read(`.github/workflows/${name}`);
      expect(workflow).toMatch(/^on:\n  workflow_dispatch:/m);
      expect(workflow).not.toMatch(/^\s*(push|pull_request|pull_request_target|schedule|workflow_run):/m);
      expect(workflow).toContain("timeout-minutes:");
      expect(workflow).toContain("cancel-in-progress: true");
      expect(workflow).toContain("contents: read");
      expect(workflow).not.toMatch(/(?:contents|pull-requests|issues): write/);
    }
  });

  test("credits and inherited license stay visible", () => {
    expect(read("LICENSE")).toContain("Business Source License");
    expect(read("NOTICE.md")).toContain("https://github.com/leeguooooo/AgentParty");
    expect(read("NOTICE.md")).toContain("Guo Li");
    expect(read("NOTICE.md")).toContain("BUSL-1.1");
  });
});
