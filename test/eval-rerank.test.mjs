import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import { buildRerankEvalReport, runRerankQualityEval } from "../src/eval-rerank.mjs";

const fixtureCatalogDir = new URL("./fixtures/catalogs/", import.meta.url);

async function writeScenarios(path, scenarios) {
  await writeFile(path, JSON.stringify(scenarios, null, 2));
}

test("rerank eval skips cleanly without a Voyage API key", async () => {
  const result = await runRerankQualityEval(
    new URL("../evals/rerank-quality/v0/scenarios.json", import.meta.url),
    {
      rerankOptions: {
        apiKey: ""
      }
    }
  );
  const report = buildRerankEvalReport(result);

  assert.equal(report.suite, "rerank-quality/v0");
  assert.equal(report.scenarioCount, 7);
  assert.equal(report.statusCounts["skipped-missing-api-key"], 7);
  assert.equal(report.metrics.deterministic.count, 7);
  assert.equal(report.metrics.shadowCompleted.count, 0);
  assert.deepEqual(report.thresholdFailures, []);
  assert.equal(report.promotion.eligible, false);
  assert.ok(report.promotion.reasons.includes("no-completed-shadow-rerank"));
});

test("rerank eval compares completed shadow ranking against deterministic ranking", async () => {
  const tmpRoot = new URL("./.test-tmp/eval-rerank-comparison/", import.meta.url);
  await rm(tmpRoot, { force: true, recursive: true });
  await mkdir(tmpRoot, { recursive: true });
  const scenarioPath = new URL("scenarios.json", tmpRoot);
  await writeScenarios(scenarioPath, [
    {
      id: "fixture-copy",
      studio: "marketing",
      prompt: "write core offer launch copy",
      expectedSkill: "copywriting"
    }
  ]);

  const result = await runRerankQualityEval(scenarioPath, {
    catalogDir: fixtureCatalogDir,
    rerankImpl: async ({ candidateCards }) => ({
      provider: "voyage",
      mode: "shadow",
      status: "completed",
      model: "fixture-rerank",
      inputCount: candidateCards.length,
      candidateCards,
      ranked: candidateCards.map((card, index) => ({
        rank: index + 1,
        index,
        originalRank: index + 1,
        name: card.name,
        source: card.source,
        skillPath: card.skillPath,
        relevanceScore: 1 - index / 10
      })),
      selectedSkillWouldChange: false
    })
  });
  const report = buildRerankEvalReport(result);

  assert.equal(report.statusCounts.completed, 1);
  assert.equal(report.metrics.deterministic.count, 1);
  assert.equal(report.metrics.shadowCompleted.count, 1);
  assert.equal(report.rows[0].rerank.ranked[0].name, report.rows[0].deterministic.topResults[0].name);
  assert.deepEqual(report.thresholdFailures, []);
});

test("rerank eval reports privacy leaks as threshold failures", async () => {
  const tmpRoot = new URL("./.test-tmp/eval-rerank-privacy/", import.meta.url);
  await rm(tmpRoot, { force: true, recursive: true });
  await mkdir(tmpRoot, { recursive: true });
  const scenarioPath = new URL("scenarios.json", tmpRoot);
  await writeScenarios(scenarioPath, [
    {
      id: "fixture-seo",
      studio: "marketing",
      prompt: "SEO content plan",
      expectedSkill: "ai-seo"
    }
  ]);

  const result = await runRerankQualityEval(scenarioPath, {
    catalogDir: fixtureCatalogDir,
    rerankImpl: async ({ candidateCards }) => ({
      provider: "voyage",
      mode: "shadow",
      status: "completed",
      model: "leaky-fixture",
      inputCount: candidateCards.length,
      candidateCards: [
        {
          ...candidateCards[0],
          body: "PRIVATE_FULL_SKILL_BODY",
          readPath: "/private/local/SKILL.md"
        }
      ],
      ranked: [
        {
          rank: 1,
          index: 0,
          originalRank: 1,
          name: candidateCards[0].name,
          source: candidateCards[0].source,
          skillPath: candidateCards[0].skillPath,
          relevanceScore: 0.99
        }
      ],
      selectedSkillWouldChange: false
    })
  });
  const report = buildRerankEvalReport(result);

  assert.equal(report.privacy.rerankBodyLeaks, 1);
  assert.equal(report.privacy.rerankReadPathLeaks, 1);
  assert.deepEqual(report.thresholdFailures, ["privacy-leak"]);
  assert.equal(report.promotion.eligible, false);
});

test("rerank eval CLI writes a report and exits cleanly without an API key", async () => {
  const tmpRoot = new URL("./.test-tmp/eval-rerank-cli/", import.meta.url);
  await rm(tmpRoot, { force: true, recursive: true });
  await mkdir(tmpRoot, { recursive: true });
  const reportPath = new URL("report.json", tmpRoot);

  const output = execFileSync(
    process.execPath,
    [
      "src/eval-rerank.mjs",
      "evals/rerank-quality/v0/scenarios.json",
      "--summary",
      "--report",
      reportPath.pathname
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        VOYAGE_API_KEY: ""
      }
    }
  );
  const summary = JSON.parse(output);
  const report = JSON.parse(await readFile(reportPath, "utf8"));

  assert.equal(summary.suite, "rerank-quality/v0");
  assert.equal(summary.statusCounts["skipped-missing-api-key"], 7);
  assert.equal(report.rows.length, 7);
  assert.equal(report.proofBoundary.includes("do not promote Voyage ordering"), true);
});
