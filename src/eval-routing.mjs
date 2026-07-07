import { readFile } from "node:fs/promises";

import { loadCatalog, searchCatalog } from "./search.mjs";

const THRESHOLDS = {
  recallAt3: 0.95,
  mrrAt3: 0.85,
  top1: 0.8,
  wrongCategory: 0.02,
  negativeFalsePositive: 0
};

function rankOf(results, expected) {
  const index = results.findIndex((entry) => entry.name === expected);
  return index === -1 ? null : index + 1;
}

function summarize(rows) {
  const positives = rows.filter((row) => row.expectedSkill);
  const negatives = rows.filter((row) => !row.expectedSkill);
  const recallAt3 = positives.filter((row) => row.rank && row.rank <= 3).length / positives.length;
  const top1 = positives.filter((row) => row.rank === 1).length / positives.length;
  const mrrAt3 =
    positives.reduce((total, row) => total + (row.rank && row.rank <= 3 ? 1 / row.rank : 0), 0) /
    positives.length;
  const wrongCategory =
    rows.filter((row) => row.selectedStudio !== row.expectedSelectedStudio).length / rows.length;
  const ambiguityRate = rows.filter((row) => row.results[0]?.confidenceLabel === "ambiguous").length / rows.length;
  const negativeFalsePositive =
    negatives.length === 0 ? 0 : negatives.filter((row) => row.results.length > 0).length / negatives.length;

  return {
    recallAt3: Number(recallAt3.toFixed(3)),
    top1: Number(top1.toFixed(3)),
    mrrAt3: Number(mrrAt3.toFixed(3)),
    wrongCategory: Number(wrongCategory.toFixed(3)),
    ambiguityRate: Number(ambiguityRate.toFixed(3)),
    negativeFalsePositive: Number(negativeFalsePositive.toFixed(3))
  };
}

function thresholdFailures(metrics) {
  const failures = [];
  if (metrics.recallAt3 < THRESHOLDS.recallAt3) failures.push(`Recall@3 ${metrics.recallAt3}`);
  if (metrics.mrrAt3 < THRESHOLDS.mrrAt3) failures.push(`MRR@3 ${metrics.mrrAt3}`);
  if (metrics.top1 < THRESHOLDS.top1) failures.push(`Top1 ${metrics.top1}`);
  if (metrics.wrongCategory > THRESHOLDS.wrongCategory) {
    failures.push(`wrong-category ${metrics.wrongCategory}`);
  }
  if (metrics.negativeFalsePositive > THRESHOLDS.negativeFalsePositive) {
    failures.push(`negative-false-positive ${metrics.negativeFalsePositive}`);
  }
  return failures;
}

export async function runRoutingEval(scenarioPath) {
  const scenarios = JSON.parse(await readFile(scenarioPath, "utf8"));
  const catalogsByStudio = new Map();
  for (const studio of [...new Set(scenarios.map((scenario) => scenario.studio))]) {
    catalogsByStudio.set(studio, await loadCatalog({ studio }));
  }

  const rows = [];

  for (const scenario of scenarios) {
    const catalog = catalogsByStudio.get(scenario.studio);
    const results = searchCatalog(catalog, scenario.prompt);
    const studioResults = [...catalogsByStudio].flatMap(([studio, studioCatalog]) =>
      searchCatalog(studioCatalog, scenario.prompt, { limit: 1 }).map((result) => ({ studio, result }))
    );
    const selectedStudio =
      studioResults.sort((a, b) => b.result.score - a.result.score || b.result.confidence - a.result.confidence)[0]
        ?.studio ?? null;
    const expectedSelectedStudio = Object.hasOwn(scenario, "expectedStudio")
      ? scenario.expectedStudio
      : scenario.expectedSkill
        ? scenario.studio
        : null;

    rows.push({
      id: scenario.id,
      expectedStudio: scenario.studio,
      expectedSelectedStudio,
      selectedStudio,
      expectedSkill: scenario.expectedSkill,
      results,
      rank: scenario.expectedSkill ? rankOf(results, scenario.expectedSkill) : null
    });
  }

  return {
    suite: "skill-routing-evals/v0",
    thresholds: THRESHOLDS,
    rows,
    metrics: summarize(rows)
  };
}

async function main() {
  const scenarioPath = process.argv[2];
  const summaryOnly = process.argv.includes("--summary");
  if (!scenarioPath) {
    console.error("Usage: node src/eval-routing.mjs evals/skill-routing-evals/v0/scenarios.json [--summary]");
    process.exitCode = 2;
    return;
  }

  const result = await runRoutingEval(scenarioPath);
  const failures = thresholdFailures(result.metrics);
  const output = summaryOnly
    ? {
        suite: result.suite,
        scenarioCount: result.rows.length,
        thresholds: result.thresholds,
        metrics: result.metrics,
        thresholdFailures: failures
      }
    : { ...result, thresholdFailures: failures };

  console.log(JSON.stringify(output, null, 2));
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
