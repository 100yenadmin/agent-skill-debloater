import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import { buildRoutingEvalReport, runRoutingEval, thresholdFailures } from "../src/eval-routing.mjs";

const fixtureCatalogDir = new URL("./fixtures/catalogs/", import.meta.url);

test("routing eval checks global studio selection and hard negatives", async () => {
  const result = await runRoutingEval(new URL("../evals/skill-routing-evals/v0/scenarios.json", import.meta.url));

  assert.equal(result.metrics.wrongCategory, 0);
  assert.equal(result.metrics.negativeFalsePositive, 0);

  const pricing = result.rows.find((row) => row.id === "marketing-pricing-unseeded");
  assert.equal(pricing.selectedStudio, null);
  assert.equal(pricing.expectedSelectedStudio, null);
});

test("committed routing eval proves must-rank-1 scenarios are currently top ranked", async () => {
  const result = await runRoutingEval(new URL("../evals/skill-routing-evals/v0/scenarios.json", import.meta.url));

  assert.ok(result.metrics.mustRank1Count > 0);
  assert.equal(result.metrics.mustRank1FailureCount, 0);
  assert.equal(
    thresholdFailures(result.metrics, {
      metricsByGroup: result.metricsByGroup,
      coverage: result.coverage
    }).some((failure) => failure.startsWith("must-rank-1")),
    false
  );
});

test("committed routing eval separates curated quality from generated provenance smoke", async () => {
  const result = await runRoutingEval(new URL("../evals/skill-routing-evals/v0/scenarios.json", import.meta.url));

  assert.ok(result.metricsByGroup["curated-intent"].positiveCount > 0);
  assert.ok(result.metricsByGroup["generated-provenance"].positiveCount > 0);
  assert.equal(result.metricsByGroup["curated-intent"].negativeFalsePositive, 0);
  assert.equal(result.metricsByGroup["curated-intent"].mustRank1FailureCount, 0);
  assert.deepEqual(result.coverage.hardNegativeStudios, ["ceo", "design", "engineering", "marketing"]);
  assert.ok(result.coverage.overlapClusters.includes("engineering-code-review"));
  assert.ok(result.coverage.overlapClusters.includes("engineering-debugging"));
  assert.ok(result.coverage.overlapClusters.includes("engineering-tdd"));
  assert.deepEqual(
    thresholdFailures(result.metrics, {
      metricsByGroup: result.metricsByGroup,
      coverage: result.coverage
    }),
    []
  );
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
        prompt: "positioning ICP core offer target audience",
        expectedSkill: "product-marketing"
      }
    ])
  );

  const result = await runRoutingEval(scenarioPath, { catalogDir: fixtureCatalogDir });

  assert.equal(result.rows.length, 2);
  assert.equal(result.metrics.recallAt3, 1);
  assert.equal(result.metrics.top1, 1);
});

test("routing eval rows include selected-skill audit traces", async () => {
  const tmpRoot = new URL("./.test-tmp/eval-routing-trace/", import.meta.url);
  await rm(tmpRoot, { force: true, recursive: true });
  await mkdir(tmpRoot, { recursive: true });
  const scenarioPath = new URL("scenarios.json", tmpRoot);
  await writeFile(
    scenarioPath,
    JSON.stringify([
      {
        id: "fixture-seo-trace",
        studio: "marketing",
        prompt: "SEO content plan",
        expectedSkill: "ai-seo"
      }
    ])
  );

  const result = await runRoutingEval(scenarioPath, { catalogDir: fixtureCatalogDir });
  const [row] = result.rows;
  const report = buildRoutingEvalReport(result);
  const [trace] = report.auditTraces;

  assert.equal(row.selectedSkill, "ai-seo");
  assert.equal(row.selectedSkillTrace.name, "ai-seo");
  assert.match(row.selectedSkillTrace.readPath, /^pack:\/\/coreyhaines31%2Fmarketingskills\//);
  assert.deepEqual(row.selectedSkillTrace.capabilities, ["read-only", "network"]);
  assert.ok(row.selectedSkillTrace.why.length > 0);
  assert.equal("body" in row.selectedSkillTrace, false);
  assert.equal(trace.selectedStudio, "marketing");
  assert.equal(trace.selectedStudioTrace.selectedSkillTrace.name, "ai-seo");
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

test("routing eval report includes failure rows with compact top results", async () => {
  const tmpRoot = new URL("./.test-tmp/eval-routing-failures/", import.meta.url);
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
        expectedSkill: "missing-skill"
      },
      {
        id: "fixture-negative",
        studio: "design",
        expectedStudio: null,
        prompt: "SEO content plan",
        expectedSkill: null
      }
    ])
  );

  const result = await runRoutingEval(scenarioPath, { catalogDir: fixtureCatalogDir });
  const report = buildRoutingEvalReport(result);

  assert.ok(report.thresholdFailures.some((failure) => failure.startsWith("Recall@3")));
  assert.equal(report.failureRows.length, 2);
  assert.deepEqual(report.failureRows[0].failureReasons, ["recall@3", "top1"]);
  assert.equal(report.failureRows[0].topResults[0].name, "ai-seo");
  assert.equal("description" in report.failureRows[0].topResults[0], false);
  assert.deepEqual(report.failureRows[1].failureReasons, [
    "selected-studio",
    "negative-false-positive"
  ]);
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

test("routing eval rejects duplicate scenario ids", async () => {
  const tmpRoot = new URL("./.test-tmp/eval-routing-duplicate/", import.meta.url);
  await rm(tmpRoot, { force: true, recursive: true });
  await mkdir(tmpRoot, { recursive: true });
  const scenarioPath = new URL("scenarios.json", tmpRoot);
  await writeFile(
    scenarioPath,
    JSON.stringify([
      {
        id: "duplicate",
        studio: "marketing",
        prompt: "SEO content plan",
        expectedSkill: "ai-seo"
      },
      {
        id: "duplicate",
        studio: "marketing",
        prompt: "Landing page copy",
        expectedSkill: "copywriting"
      }
    ])
  );

  await assert.rejects(runRoutingEval(scenarioPath, { catalogDir: fixtureCatalogDir }), /id must be unique/);
});

test("routing eval rejects mustRank1 scenarios without expectedSkill", async () => {
  const tmpRoot = new URL("./.test-tmp/eval-routing-malformed/", import.meta.url);
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
        id: "malformed-must-rank-1",
        studio: "marketing",
        prompt: "Repair a database issue.",
        expectedSkill: null,
        mustRank1: true
      }
    ])
  );

  await assert.rejects(
    runRoutingEval(scenarioPath, { catalogDir: fixtureCatalogDir }),
    /malformed-must-rank-1 sets mustRank1 without expectedSkill/
  );
});

test("routing eval CLI writes a full JSON report while printing summary", async () => {
  const tmpRoot = new URL("./.test-tmp/eval-routing-report/", import.meta.url);
  await rm(tmpRoot, { force: true, recursive: true });
  await mkdir(tmpRoot, { recursive: true });
  const scenarioPath = new URL("../evals/skill-routing-evals/v0/scenarios.json", import.meta.url);
  const reportPath = new URL("reports/routing-report.json", tmpRoot);

  const output = execFileSync(
    process.execPath,
    [
      "src/eval-routing.mjs",
      scenarioPath.pathname,
      "--summary",
      "--report",
      reportPath.pathname
    ],
    { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" }
  );

  const summary = JSON.parse(output);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const scenarioCount = JSON.parse(await readFile(scenarioPath, "utf8")).length;

  assert.equal(summary.scenarioCount, scenarioCount);
  assert.equal(summary.thresholdFailures.length, 0);
  assert.equal(summary.failureRows.length, 0);
  assert.ok(Array.isArray(summary.ambiguityRows));
  assert.ok(summary.metricsByGroup["curated-intent"].positiveCount > 0);
  assert.ok(summary.metricsByGroup["generated-provenance"].positiveCount > 0);
  assert.ok(summary.coverage.hardNegativeStudios.includes("engineering"));
  assert.ok(summary.coverage.overlapClusters.includes("engineering-debugging"));
  assert.equal(report.auditTraces.length, scenarioCount);
  assert.equal(report.auditTraces[0].selectedSkillTrace.name, "baoyu-cover-image");
});

test("routing eval CLI summary exposes ambiguity rows when ambiguity threshold fails", async () => {
  const tmpRoot = new URL("./.test-tmp/eval-routing-ambiguous-summary/", import.meta.url);
  await rm(tmpRoot, { force: true, recursive: true });
  await mkdir(tmpRoot, { recursive: true });
  const scenarioPath = new URL("scenarios.json", tmpRoot);
  await writeFile(
    scenarioPath,
    JSON.stringify([
      {
        id: "ambiguous-seo",
        studio: "marketing",
        prompt: "SEO content plan",
        expectedSkill: "ai-seo"
      }
    ])
  );

  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        ["src/eval-routing.mjs", scenarioPath.pathname, "--summary"],
        { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8", stdio: "pipe" }
      ),
    (error) => {
      const summary = JSON.parse(error.stdout);
      assert.ok(summary.thresholdFailures.includes("ambiguity-rate 1"));
      assert.equal(summary.failureRows.length, 0);
      assert.equal(summary.ambiguityRows.length, 1);
      assert.equal(summary.ambiguityRows[0].id, "ambiguous-seo");
      assert.equal(summary.ambiguityRows[0].selectedSkill, "ai-seo");
      return true;
    }
  );
});

test("routing eval threshold checks use raw metrics before display rounding", () => {
  const failures = thresholdFailures({
    recallAt3: 0.9496,
    mrrAt3: 1,
    top1: 1,
    wrongCategory: 0,
    wrongCategoryCount: 0,
    ambiguityRate: 0,
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
    ambiguityRate: 0.21,
    negativeFalsePositive: 0,
    mustRank1FailureCount: 1
  });

  assert.deepEqual(failures, ["ambiguity-rate 0.21", "must-rank-1 1 failures"]);
});
