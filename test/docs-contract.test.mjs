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

test("launch packet stays market-facing without crossing approval boundaries", async () => {
  const packet = await readDoc("launch-packet.md");
  const demo = await readDoc("demo-router-flow.md");

  for (const required of [
    "Plugin-first searchable catalogs for hidden/read-on-demand agent skill packs",
    "GitHub prerelease",
    "Tagged artifact acceptance",
    "Supported Studios And Seed Packs",
    "Quickstart For RC Evaluation",
    "Maintainer Launch Checklist",
    "does not publish to npm",
    "does not include upstream OpenClaw core changes",
    "does not prove customer VM rollout readiness",
    "issues #45 through #48"
  ]) {
    assert.match(packet, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(packet, /Hidden\/read-on-demand reduces prompt bloat; it is not a security boundary\./);
  assert.match(demo, /debloat-skill-search design "launch hero cover image"/);
  assert.match(demo, /pack:\/\/jimliu%2Fbaoyu-skills\/skills\/baoyu-cover-image\/SKILL\.md/);
  assert.match(demo, /does\s+not\s+prove\s+customer VM rollout readiness/i);
});
