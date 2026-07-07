import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadCatalog, searchCatalog } from "./search.mjs";

const THRESHOLDS = {
  recallAt3: 0.95,
  mrrAt3: 0.85,
  top1: 0.8,
  wrongCategory: 0.05,
  wrongCategoryMaxCount: 1,
  ambiguityRate: 0.2,
  negativeFalsePositive: 0,
  mustRank1Failures: 0,
  curatedIntentRecallAt3: 0.95,
  curatedIntentMrrAt3: 0.85,
  curatedIntentTop1: 0.8,
  curatedIntentNegativeFalsePositive: 0,
  curatedIntentMustRank1Failures: 0,
  minHardNegativeStudios: 4,
  minOverlapClusters: 2
};

const DEFAULT_SCENARIO_GROUP = "curated-intent";
const VALID_SCENARIO_GROUPS = new Set([DEFAULT_SCENARIO_GROUP, "generated-provenance"]);

function rankOf(results, expected) {
  const index = results.findIndex((entry) => entry.name === expected);
  return index === -1 ? null : index + 1;
}

function validateScenario(scenario, index) {
  const label = scenario.id ?? `scenario[${index}]`;
  if (!scenario.id) {
    throw new Error(`Routing eval scenario[${index}] is missing id`);
  }
  if (!scenario.studio) {
    throw new Error(`Routing eval ${label} is missing studio`);
  }
  if (typeof scenario.prompt !== "string" || !scenario.prompt.trim()) {
    throw new Error(`Routing eval ${label} is missing prompt`);
  }
  if (scenario.mustRank1 && !scenario.expectedSkill) {
    throw new Error(`Routing eval ${label} sets mustRank1 without expectedSkill`);
  }
  if (
    Object.hasOwn(scenario, "expectedStudio") &&
    scenario.expectedStudio !== null &&
    typeof scenario.expectedStudio !== "string"
  ) {
    throw new Error(`Routing eval ${label} expectedStudio must be a string or null`);
  }
  if (Object.hasOwn(scenario, "scenarioGroup") && !VALID_SCENARIO_GROUPS.has(scenario.scenarioGroup)) {
    throw new Error(
      `Routing eval ${label} scenarioGroup must be one of ${[...VALID_SCENARIO_GROUPS].join(", ")}`
    );
  }
  if (Object.hasOwn(scenario, "overlapCluster") && typeof scenario.overlapCluster !== "string") {
    throw new Error(`Routing eval ${label} overlapCluster must be a string`);
  }
}

function summarize(rows) {
  if (rows.length === 0) {
    throw new Error("Routing eval requires at least one scenario");
  }
  const positives = rows.filter((row) => row.expectedSkill);
  if (positives.length === 0) {
    throw new Error("Routing eval requires at least one positive expectedSkill scenario");
  }
  const hardNegatives = rows.filter((row) => !row.expectedSkill && row.expectedSelectedStudio === null);
  const mustRank1Rows = positives.filter((row) => row.mustRank1);
  const recallAt3 = positives.filter((row) => row.rank && row.rank <= 3).length / positives.length;
  const top1 = positives.filter((row) => row.rank === 1).length / positives.length;
  const mrrAt3 =
    positives.reduce((total, row) => total + (row.rank && row.rank <= 3 ? 1 / row.rank : 0), 0) /
    positives.length;
  const wrongCategoryCount = rows.filter((row) => row.selectedStudio !== row.expectedSelectedStudio).length;
  const wrongCategory =
    wrongCategoryCount / rows.length;
  const ambiguityRate = rows.filter((row) => row.results[0]?.confidenceLabel === "ambiguous").length / rows.length;
  const negativeFalsePositiveCount = hardNegatives.filter((row) => row.selectedStudio !== null).length;
  const negativeFalsePositive =
    hardNegatives.length === 0 ? 0 : negativeFalsePositiveCount / hardNegatives.length;
  const mustRank1FailureCount = mustRank1Rows.filter((row) => row.rank !== 1).length;

  return {
    positiveCount: positives.length,
    hardNegativeCount: hardNegatives.length,
    mustRank1Count: mustRank1Rows.length,
    wrongCategoryCount,
    negativeFalsePositiveCount,
    mustRank1FailureCount,
    recallAt3,
    top1,
    mrrAt3,
    wrongCategory,
    ambiguityRate,
    negativeFalsePositive
  };
}

function summarizeOptional(rows) {
  return rows.length === 0 ? null : summarize(rows);
}

function rowsByGroup(rows) {
  return rows.reduce((groups, row) => {
    const existing = groups.get(row.scenarioGroup) ?? [];
    existing.push(row);
    groups.set(row.scenarioGroup, existing);
    return groups;
  }, new Map());
}

function hardNegativeStudios(rows) {
  return [
    ...new Set(
      rows
        .filter((row) => !row.expectedSkill && row.expectedSelectedStudio === null)
        .map((row) => row.expectedStudio)
    )
  ].sort();
}

function overlapClusters(rows) {
  return [
    ...new Set(
      rows
        .map((row) => row.overlapCluster)
        .filter(Boolean)
    )
  ].sort();
}

export function thresholdFailures(metrics, { metricsByGroup = {}, coverage = {} } = {}) {
  const failures = [];
  if (metrics.recallAt3 < THRESHOLDS.recallAt3) failures.push(`Recall@3 ${metrics.recallAt3}`);
  if (metrics.mrrAt3 < THRESHOLDS.mrrAt3) failures.push(`MRR@3 ${metrics.mrrAt3}`);
  if (metrics.top1 < THRESHOLDS.top1) failures.push(`Top1 ${metrics.top1}`);
  if (
    metrics.wrongCategory > THRESHOLDS.wrongCategory ||
    metrics.wrongCategoryCount > THRESHOLDS.wrongCategoryMaxCount
  ) {
    failures.push(`wrong-category ${metrics.wrongCategory} (${metrics.wrongCategoryCount} mismatches)`);
  }
  if (metrics.ambiguityRate > THRESHOLDS.ambiguityRate) {
    failures.push(`ambiguity-rate ${metrics.ambiguityRate}`);
  }
  if (metrics.negativeFalsePositive > THRESHOLDS.negativeFalsePositive) {
    failures.push(
      `negative-false-positive ${metrics.negativeFalsePositive} (${metrics.negativeFalsePositiveCount ?? 0} false positives)`
    );
  }
  if (metrics.mustRank1FailureCount > THRESHOLDS.mustRank1Failures) {
    failures.push(`must-rank-1 ${metrics.mustRank1FailureCount} failures`);
  }
  const hasGroupedInputs = Object.keys(metricsByGroup).length > 0 || Object.keys(coverage).length > 0;
  if (hasGroupedInputs) {
    const curated = metricsByGroup[DEFAULT_SCENARIO_GROUP];
    if (!curated) {
      failures.push("curated-intent metrics missing");
    } else {
      if (curated.recallAt3 < THRESHOLDS.curatedIntentRecallAt3) {
        failures.push(`curated-intent Recall@3 ${curated.recallAt3}`);
      }
      if (curated.mrrAt3 < THRESHOLDS.curatedIntentMrrAt3) {
        failures.push(`curated-intent MRR@3 ${curated.mrrAt3}`);
      }
      if (curated.top1 < THRESHOLDS.curatedIntentTop1) {
        failures.push(`curated-intent Top1 ${curated.top1}`);
      }
      if (curated.negativeFalsePositive > THRESHOLDS.curatedIntentNegativeFalsePositive) {
        failures.push(
          `curated-intent negative-false-positive ${curated.negativeFalsePositive} (${curated.negativeFalsePositiveCount ?? 0} false positives)`
        );
      }
      if (curated.mustRank1FailureCount > THRESHOLDS.curatedIntentMustRank1Failures) {
        failures.push(`curated-intent must-rank-1 ${curated.mustRank1FailureCount} failures`);
      }
    }
    if ((coverage.hardNegativeStudios?.length ?? 0) < THRESHOLDS.minHardNegativeStudios) {
      failures.push(
        `hard-negative studio coverage ${coverage.hardNegativeStudios?.length ?? 0}/${THRESHOLDS.minHardNegativeStudios}`
      );
    }
    if ((coverage.overlapClusters?.length ?? 0) < THRESHOLDS.minOverlapClusters) {
      failures.push(`overlap cluster coverage ${coverage.overlapClusters?.length ?? 0}/${THRESHOLDS.minOverlapClusters}`);
    }
  }
  return failures;
}

function selectedSkillTrace(result) {
  if (!result) return null;
  return {
    name: result.name,
    title: result.title,
    studio: result.studio,
    source: result.source,
    pack: result.pack,
    skillPath: result.skillPath,
    readPath: result.readPath,
    sourceCommit: result.sourceCommit,
    sourceUrl: result.sourceUrl,
    capabilities: result.capabilities,
    confidence: result.confidence,
    confidenceLabel: result.confidenceLabel,
    score: result.score,
    why: result.why
  };
}

function rowFailureReasons(row) {
  const reasons = [];
  if (row.selectedStudio !== row.expectedSelectedStudio) {
    reasons.push("selected-studio");
  }
  if (row.expectedSkill && (!row.rank || row.rank > 3)) {
    reasons.push("recall@3");
  }
  if (row.expectedSkill && row.rank !== 1) {
    reasons.push("top1");
  }
  if (row.mustRank1 && row.rank !== 1) {
    reasons.push("must-rank-1");
  }
  if (!row.expectedSkill && row.expectedSelectedStudio === null && row.selectedStudio !== null) {
    reasons.push("negative-false-positive");
  }
  return [...new Set(reasons)];
}

export function buildRoutingEvalReport(result) {
  const failures = thresholdFailures(result.metrics, {
    metricsByGroup: result.metricsByGroup,
    coverage: result.coverage
  });
  const rows = result.rows.map((row) => ({
    ...row,
    failureReasons: rowFailureReasons(row)
  }));

  return {
    suite: result.suite,
    scenarioCount: rows.length,
    thresholds: result.thresholds,
    metrics: result.metrics,
    metricsByGroup: result.metricsByGroup,
    coverage: result.coverage,
    thresholdFailures: failures,
    failureRows: rows
      .filter((row) => row.failureReasons.length > 0)
      .map((row) => ({
        id: row.id,
        prompt: row.prompt,
        expectedStudio: row.expectedStudio,
        expectedSelectedStudio: row.expectedSelectedStudio,
        selectedStudio: row.selectedStudio,
        expectedSkill: row.expectedSkill,
        scenarioGroup: row.scenarioGroup,
        overlapCluster: row.overlapCluster,
        selectedSkill: row.selectedSkill,
        rank: row.rank,
        failureReasons: row.failureReasons,
        topResults: row.results.map((entry) => ({
          name: entry.name,
          source: entry.source,
          confidence: entry.confidence,
          confidenceLabel: entry.confidenceLabel,
          readPath: entry.readPath
        }))
      })),
    ambiguityRows: rows
      .filter((row) => row.results[0]?.confidenceLabel === "ambiguous")
      .map((row) => ({
        id: row.id,
        selectedSkill: row.selectedSkill,
        confidence: row.results[0]?.confidence ?? null,
        readPath: row.selectedSkillTrace?.readPath ?? null
      })),
    auditTraces: rows.map((row) => ({
      id: row.id,
      scenarioGroup: row.scenarioGroup,
      overlapCluster: row.overlapCluster,
      selectedStudio: row.selectedStudio,
      selectedSkill: row.selectedSkill,
      selectedSkillTrace: row.selectedSkillTrace,
      selectedStudioTrace: row.selectedStudioTrace
    })),
    rows
  };
}

export async function runRoutingEval(scenarioPath, { catalogDir } = {}) {
  const scenarios = JSON.parse(await readFile(scenarioPath, "utf8"));
  if (!Array.isArray(scenarios)) {
    throw new Error("Routing eval scenarios must be a JSON array");
  }
  if (scenarios.length === 0) {
    throw new Error("Routing eval requires at least one scenario");
  }
  scenarios.forEach(validateScenario);
  const ids = new Set();
  for (const scenario of scenarios) {
    if (ids.has(scenario.id)) {
      throw new Error(`Routing eval scenario id must be unique: ${scenario.id}`);
    }
    ids.add(scenario.id);
  }
  const catalogsByStudio = new Map();
  for (const studio of [...new Set(scenarios.map((scenario) => scenario.studio))]) {
    catalogsByStudio.set(studio, await loadCatalog({ studio, ...(catalogDir ? { catalogDir } : {}) }));
  }

  const rows = [];

  for (const scenario of scenarios) {
    const catalog = catalogsByStudio.get(scenario.studio);
    const results = searchCatalog(catalog, scenario.prompt);
    const studioResults = [...catalogsByStudio].flatMap(([studio, studioCatalog]) =>
      searchCatalog(studioCatalog, scenario.prompt, { limit: 1 }).map((result) => ({ studio, result }))
    );
    const selectedStudioCandidate =
      studioResults.sort((a, b) => b.result.score - a.result.score || b.result.confidence - a.result.confidence)[0] ??
      null;
    const selectedStudio = selectedStudioCandidate?.studio ?? null;
    const selectedResult = results[0] ?? null;
    const expectedSelectedStudio = Object.hasOwn(scenario, "expectedStudio")
      ? scenario.expectedStudio
      : scenario.expectedSkill
        ? scenario.studio
        : null;

    rows.push({
      id: scenario.id,
      prompt: scenario.prompt,
      scenarioGroup: scenario.scenarioGroup ?? DEFAULT_SCENARIO_GROUP,
      overlapCluster: scenario.overlapCluster ?? null,
      expectedStudio: scenario.studio,
      expectedSelectedStudio,
      selectedStudio,
      selectedStudioTrace: selectedStudioCandidate
        ? {
            studio: selectedStudioCandidate.studio,
            selectedSkillTrace: selectedSkillTrace(selectedStudioCandidate.result)
          }
        : null,
      expectedSkill: scenario.expectedSkill,
      selectedSkill: selectedResult?.name ?? null,
      selectedSkillTrace: selectedSkillTrace(selectedResult),
      mustRank1: Boolean(scenario.mustRank1),
      results,
      rank: scenario.expectedSkill ? rankOf(results, scenario.expectedSkill) : null
    });
  }

  const groupedRows = rowsByGroup(rows);
  const metricsByGroup = Object.fromEntries(
    [...groupedRows].map(([group, groupRows]) => [group, summarizeOptional(groupRows)])
  );
  const coverage = {
    hardNegativeStudios: hardNegativeStudios(rows.filter((row) => row.scenarioGroup === DEFAULT_SCENARIO_GROUP)),
    overlapClusters: overlapClusters(rows.filter((row) => row.scenarioGroup === DEFAULT_SCENARIO_GROUP))
  };

  return {
    suite: "skill-routing-evals/v0",
    thresholds: THRESHOLDS,
    rows,
    metrics: summarize(rows),
    metricsByGroup,
    coverage
  };
}

function parseCliArgs(argv) {
  const [scenarioPath, ...rest] = argv;
  const options = {
    scenarioPath,
    summaryOnly: false,
    reportPath: null
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];

    if (arg === "--summary") {
      options.summaryOnly = true;
    } else if (arg === "--report") {
      if (!next || next.startsWith("--")) {
        throw new Error("--report requires a path");
      }
      options.reportPath = next;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function writeReport(reportPath, report) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error("Usage: node src/eval-routing.mjs evals/skill-routing-evals/v0/scenarios.json [--summary] [--report PATH]");
    process.exitCode = 2;
    return;
  }
  const { scenarioPath, summaryOnly, reportPath } = options;
  if (!scenarioPath) {
    console.error("Usage: node src/eval-routing.mjs evals/skill-routing-evals/v0/scenarios.json [--summary] [--report PATH]");
    process.exitCode = 2;
    return;
  }

  const result = await runRoutingEval(scenarioPath);
  const report = buildRoutingEvalReport(result);
  const output = summaryOnly
    ? {
        suite: report.suite,
        scenarioCount: report.scenarioCount,
        thresholds: report.thresholds,
        metrics: report.metrics,
        metricsByGroup: report.metricsByGroup,
        coverage: report.coverage,
        thresholdFailures: report.thresholdFailures,
        failureRows: report.failureRows,
        ambiguityRows: report.ambiguityRows
      }
    : report;

  if (reportPath) {
    await writeReport(reportPath, report);
  }

  console.log(JSON.stringify(output, null, 2));
  if (report.thresholdFailures.length > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
