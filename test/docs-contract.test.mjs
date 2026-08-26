import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

async function readDoc(name) {
  return readFile(new URL(`../docs/${name}`, import.meta.url), "utf8");
}

test("launch packet stays market-facing without crossing approval boundaries", async () => {
  const packet = await readDoc("launch-packet.md");
  const demo = await readDoc("demo-router-flow.md");

  for (const required of [
    "Plugin-first searchable catalogs for hidden/read-on-demand agent skill packs",
    "GitHub release",
    "Tagged artifact acceptance",
    "Supported Studios And Seed Packs",
    "Quickstart For Release Evaluation",
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

test("retired OpenClaw strategy docs and roadmap item stay removed", async () => {
  const docs = await readdir(new URL("../docs/", import.meta.url));
  for (const retired of [
    "openclaw-core-primitives.md",
    "runtime-canary-plan.md",
    "customer-canary-plan.md"
  ]) {
    assert.equal(docs.includes(retired), false);
  }

  const roadmap = await readDoc("roadmap.md");
  assert.doesNotMatch(roadmap, /OpenClaw core primitive adoption/i);
});

test("npm approval gate remains explicit without retired strategy docs", async () => {
  const npmGate = await readDoc("npm-publication-gate.md");

  for (const required of [
    "Do not run a real `npm publish`",
    "explicit approval comment",
    "Do not publish an untagged working tree",
    "npm publish --dry-run --ignore-scripts --provenance=false --tag rc",
    "does not prove customer VM rollout readiness"
  ]) {
    assert.match(npmGate, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
