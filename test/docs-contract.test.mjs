import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readDoc(name) {
  return readFile(new URL(`../docs/${name}`, import.meta.url), "utf8");
}

test("runtime canary plan captures rollout boundary, rollback, and evidence gates", async () => {
  const plan = await readDoc("runtime-canary-plan.md");

  for (const required of [
    "upstream OpenClaw code changes, pull requests, or merges",
    "customer VM writes",
    "fleet default skill-stack rollout",
    "npm publication",
    "Phase 1: Golden VM Canary",
    "Phase 2: One Customer VM Canary",
    "Rollback",
    "Stop conditions",
    "Evidence Checklist",
    "package-acceptance/v0",
    "runtime_safe"
  ]) {
    assert.match(plan, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(plan, /does not prove runtime safety/i);
  assert.match(plan, /Hidden\/read-on-demand reduces prompt bloat\. It is not a security boundary\./);
});
