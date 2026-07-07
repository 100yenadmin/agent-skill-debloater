import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import { runRoutingEval, thresholdFailures } from "../src/eval-routing.mjs";

const fixtureCatalogDir = new URL("./fixtures/catalogs/", import.meta.url);

test("routing eval checks global studio selection and hard negatives", async () => {
  const result = await runRoutingEval(new URL("../evals/skill-routing-evals/v0/scenarios.json", import.meta.url));

  assert.equal(result.metrics.wrongCategory, 0);
  assert.equal(result.metrics.negativeFalsePositive, 0);

  const pricing = result.rows.find((row) => row.id === "marketing-pricing-unseeded");
  assert.equal(pricing.selectedStudio, null);
  assert.equal(pricing.expectedSelectedStudio, null);
});

test("routing eval can run against committed fixture catalogs", async () => {
  const tmpRoot = new URL("./.test-tmp/eval-routing-fixture/", import.meta.url);
  await rm(tmpRoot, { force: true, recursive: true });
  await mkdir(tmpRoot, { recursive: true });
  const scenarioPath = new URL("scenarios.json", tmpRoot);
  await writeFile(
    scenarioPath,
    JSON.stringify([
      {
        id: "fixture-diagram",
        studio: "design",
        prompt: "diagram the runtime architecture",
        expectedSkill: "baoyu-diagram"
      },
      {
        id: "fixture-seo",
        studio: "marketing",
        prompt: "SEO content plan",
        expectedSkill: "ai-seo"
      }
    ])
  );

  const result = await runRoutingEval(scenarioPath, { catalogDir: fixtureCatalogDir });

  assert.equal(result.rows.length, 2);
  assert.equal(result.metrics.recallAt3, 1);
  assert.equal(result.metrics.top1, 1);
});

test("routing eval hard negatives count global selected-studio false positives", async () => {
  const tmpRoot = new URL("./.test-tmp/eval-routing-negative/", import.meta.url);
  await rm(tmpRoot, { force: true, recursive: true });
  await mkdir(tmpRoot, { recursive: true });
  const scenarioPath = new URL("scenarios.json", tmpRoot);
  await writeFile(
    scenarioPath,
    JSON.stringify([
      {
        id: "fixture-positive",
        studio: "marketing",
        prompt: "SEO content plan",
        expectedSkill: "ai-seo"
      },
      {
        id: "cross-studio-negative",
        studio: "design",
        expectedStudio: null,
        prompt: "Create an SEO content plan for organic acquisition.",
        expectedSkill: null
      }
    ])
  );

  const result = await runRoutingEval(scenarioPath, { catalogDir: fixtureCatalogDir });

  assert.equal(result.rows.find((row) => row.id === "cross-studio-negative").selectedStudio, "marketing");
  assert.equal(result.metrics.negativeFalsePositive, 1);
  assert.match(thresholdFailures(result.metrics).join("\n"), /negative-false-positive/);
});

test("routing eval rejects empty or zero-positive scenario suites", async () => {
  const tmpRoot = new URL("./.test-tmp/eval-routing-empty/", import.meta.url);
  await rm(tmpRoot, { force: true, recursive: true });
  await mkdir(tmpRoot, { recursive: true });

  const emptyPath = new URL("empty.json", tmpRoot);
  await writeFile(emptyPath, JSON.stringify([]));
  await assert.rejects(runRoutingEval(emptyPath, { catalogDir: fixtureCatalogDir }), /at least one scenario/);

  const zeroPositivePath = new URL("zero-positive.json", tmpRoot);
  await writeFile(
    zeroPositivePath,
    JSON.stringify([
      {
        id: "negative-only",
        studio: "marketing",
        expectedStudio: null,
        prompt: "Repair a Kubernetes storage class bug.",
        expectedSkill: null
      }
    ])
  );
  await assert.rejects(runRoutingEval(zeroPositivePath, { catalogDir: fixtureCatalogDir }), /positive expectedSkill/);
});

test("routing eval threshold checks use raw metrics before display rounding", () => {
  const failures = thresholdFailures({
    recallAt3: 0.9496,
    mrrAt3: 1,
    top1: 1,
    wrongCategory: 0,
    wrongCategoryCount: 0,
    negativeFalsePositive: 0,
    mustRank1FailureCount: 0
  });

  assert.deepEqual(failures, ["Recall@3 0.9496"]);
});

test("routing eval fails smoke regressions marked mustRank1", () => {
  const failures = thresholdFailures({
    recallAt3: 1,
    mrrAt3: 1,
    top1: 1,
    wrongCategory: 0,
    wrongCategoryCount: 0,
    negativeFalsePositive: 0,
    mustRank1FailureCount: 1
  });

  assert.deepEqual(failures, ["must-rank-1 1 failures"]);
});
