import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const candidateStudios = [
  "Sales Studio",
  "Support Studio",
  "Research Studio",
  "Ops Studio",
  "Docs Studio",
  "Finance Studio",
  "Customer Success Studio"
];
const activeRouterSkills = [
  "ceo-studio",
  "design-studio",
  "engineering-studio",
  "marketing-studio"
];

async function readFutureStudiosDoc() {
  return readFile(new URL("../docs/future-studios.md", import.meta.url), "utf8");
}

test("future studio discovery doc covers candidates, thresholds, and proof boundary", async () => {
  const doc = await readFutureStudiosDoc();

  assert.match(doc, /future-studio-discovery\/v0/);
  for (const studio of candidateStudios) {
    assert.match(doc, new RegExp(`\\| ${studio.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\|`));
  }
  for (const required of [
    "Recall@3 >= 0.95",
    "Top1 >= 0.80",
    "MRR@3 >= 0.85",
    "wrong-studio rate <= 0.05",
    "hard-negative false positives = 0",
    "no machine-local paths"
  ]) {
    assert.match(doc, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.match(doc, /target user and recurring job/i);
  assert.match(doc, /source skill packs and license\/provenance posture/i);
  assert.match(doc, /overlap analysis against existing studios/i);
  assert.match(doc, /capability labels/i);
  assert.match(doc, /fresh-agent smoke tasks/i);
  assert.match(doc, /backlog readiness only/i);
  assert.match(doc, /not implementation approval/i);
});

test("future studio promotion checklist requires schemas, evals, hard negatives, and smokes", async () => {
  const doc = await readFutureStudiosDoc();

  for (const required of [
    "manifest, lockfile, overlay, catalog, and schema validation",
    "no upstream skill-body vendoring",
    "no one-tool-per-skill default visibility",
    "router skill prompt surface remains compact",
    "skill-routing-evals/v0",
    "positives, hard negatives, and",
    "cross-studio ambiguity prompts",
    "fresh-agent smokes",
    "no whole-pack loading"
  ]) {
    assert.match(doc, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.match(doc, /selected\s+`SKILL\.md` read path/i);
});

test("future studio discovery does not add new visible router skills or overlay studios", async () => {
  const skillDirs = await readdir(new URL("../skills/", import.meta.url));
  const overlay = JSON.parse(await readFile(new URL("../overlays/studios.json", import.meta.url), "utf8"));

  assert.deepEqual(skillDirs.sort(), activeRouterSkills.sort());
  assert.deepEqual(Object.keys(overlay.studios).sort(), ["ceo", "design", "engineering", "marketing"]);
  for (const candidate of ["sales", "support", "research", "ops", "docs", "finance", "customer-success"]) {
    assert.equal(overlay.studios[candidate], undefined);
  }
});
