import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildRerankCandidateCards,
  defaultCatalogDir,
  loadCatalog,
  runVoyageRerank,
  searchCatalog
} from "./search.mjs";

const SUITE = "rerank-quality/v0";
const DEFAULT_LIMIT = 5;
const THRESHOLDS = {
  promotionMrrAt3Gain: 0.05,
  promotionTop1Gain: 0.05,
  maxRecallAt3Loss: 0,
  privacyLeakCount: 0
};
const PROOF_BOUNDARY =
  "Rerank quality evals are advisory shadow evidence only; they do not promote Voyage ordering.";

function toPath(input) {
  if (input instanceof URL) return fileURLToPath(input);
  if (typeof input !== "string") {
    throw new TypeError("scenarioPath must be a string path or file URL");
  }
  if (input.startsWith("file:")) return fileURLToPath(input);
  return input;
}

function validateScenario(scenario) {
  for (const field of ["id", "studio", "prompt", "expectedSkill"]) {
    if (typeof scenario[field] !== "string" || scenario[field].length === 0) {
      throw new Error(`Rerank scenario ${scenario.id ?? "<unknown>"} ${field} must be a non-empty string`);
    }
  }
}

function rankOfNames(names, expectedSkill) {
  const index = names.indexOf(expectedSkill);
  return index === -1 ? null : index + 1;
}

function rankMetrics(ranks) {
  if (ranks.length === 0) {
    return {
      count: 0,
      recallAt3: null,
      top1: null,
      mrrAt3: null
    };
  }

  const hitsAt3 = ranks.filter((rank) => rank !== null && rank <= 3).length;
  const top1 = ranks.filter((rank) => rank === 1).length;
  const reciprocal = ranks.reduce((sum, rank) => {
    if (rank === null || rank > 3) return sum;
    return sum + 1 / rank;
  }, 0);

  return {
    count: ranks.length,
    recallAt3: hitsAt3 / ranks.length,
    top1: top1 / ranks.length,
    mrrAt3: reciprocal / ranks.length
  };
}

function deltaMetric(next, base) {
  if (next === null || base === null) return null;
  return Number((next - base).toFixed(6));
}

function compactResults(results) {
  return results.map((result, index) => ({
    rank: index + 1,
    name: result.name,
    source: result.source,
    confidence: result.confidence,
    confidenceLabel: result.confidenceLabel,
    skillPath: result.skillPath
  }));
}

function countPrivateFieldLeaks(cards) {
  const values = Array.isArray(cards) ? cards : [];
  return {
    body: values.filter((card) => "body" in card || "rawBody" in card || "skillBody" in card).length,
    readPath: values.filter((card) => "readPath" in card).length
  };
}

function statusCounts(rows) {
  const counts = {};
  for (const row of rows) {
    counts[row.rerank.status] = (counts[row.rerank.status] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function promotionDecision({ completedRows, deterministicCompleted, shadowCompleted, privacy }) {
  const reasons = [];
  const deltas = {
    recallAt3: deltaMetric(shadowCompleted.recallAt3, deterministicCompleted.recallAt3),
    top1: deltaMetric(shadowCompleted.top1, deterministicCompleted.top1),
    mrrAt3: deltaMetric(shadowCompleted.mrrAt3, deterministicCompleted.mrrAt3)
  };
  const privacyLeakCount = privacy.candidateBodyLeaks + privacy.candidateReadPathLeaks + privacy.rerankBodyLeaks + privacy.rerankReadPathLeaks;

  if (completedRows.length === 0) reasons.push("no-completed-shadow-rerank");
  if (privacyLeakCount > THRESHOLDS.privacyLeakCount) reasons.push("privacy-leak");
  if (deltas.recallAt3 !== null && deltas.recallAt3 < -THRESHOLDS.maxRecallAt3Loss) {
    reasons.push("recall@3-regression");
  }
  const mrrGain = deltas.mrrAt3 !== null && deltas.mrrAt3 >= THRESHOLDS.promotionMrrAt3Gain;
  const top1Gain = deltas.top1 !== null && deltas.top1 >= THRESHOLDS.promotionTop1Gain;
  if (completedRows.length > 0 && !mrrGain && !top1Gain) {
    reasons.push("insufficient-mrr-or-top1-gain");
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    deltas,
    criteria:
      "Future promotion requires >=5% absolute MRR@3 or Top1 gain, no Recall@3 loss, and no privacy regression."
  };
}

export function buildRerankEvalReport(result) {
  const completedRows = result.rows.filter((row) => row.rerank.status === "completed");
  const deterministic = rankMetrics(result.rows.map((row) => row.deterministic.rank));
  const deterministicCompleted = rankMetrics(completedRows.map((row) => row.deterministic.rank));
  const shadowCompleted = rankMetrics(completedRows.map((row) => row.shadow.rank));
  const privacy = result.rows.reduce(
    (acc, row) => ({
      candidateBodyLeaks: acc.candidateBodyLeaks + row.privacy.candidateBodyLeaks,
      candidateReadPathLeaks: acc.candidateReadPathLeaks + row.privacy.candidateReadPathLeaks,
      rerankBodyLeaks: acc.rerankBodyLeaks + row.privacy.rerankBodyLeaks,
      rerankReadPathLeaks: acc.rerankReadPathLeaks + row.privacy.rerankReadPathLeaks
    }),
    {
      candidateBodyLeaks: 0,
      candidateReadPathLeaks: 0,
      rerankBodyLeaks: 0,
      rerankReadPathLeaks: 0
    }
  );
  const promotion = promotionDecision({
    completedRows,
    deterministicCompleted,
    shadowCompleted,
    privacy
  });
  const thresholdFailures = [];
  if (promotion.reasons.includes("privacy-leak")) thresholdFailures.push("privacy-leak");

  return {
    suite: SUITE,
    scenarioCount: result.rows.length,
    thresholds: THRESHOLDS,
    statusCounts: statusCounts(result.rows),
    metrics: {
      deterministic,
      deterministicCompleted,
      shadowCompleted
    },
    privacy,
    promotion,
    thresholdFailures,
    proofBoundary: PROOF_BOUNDARY,
    rows: result.rows
  };
}

export async function runRerankQualityEval(
  scenarioPath,
  {
    catalogDir = defaultCatalogDir(),
    limit = DEFAULT_LIMIT,
    rerankImpl = runVoyageRerank,
    rerankOptions = {}
  } = {}
) {
  const scenarios = JSON.parse(await readFile(toPath(scenarioPath), "utf8"));
  if (!Array.isArray(scenarios)) {
    throw new Error("Rerank eval scenarios must be a JSON array");
  }
  if (scenarios.length === 0) {
    throw new Error("Rerank eval requires at least one scenario");
  }
  scenarios.forEach(validateScenario);
  const ids = new Set();
  for (const scenario of scenarios) {
    if (ids.has(scenario.id)) throw new Error(`Rerank eval scenario id must be unique: ${scenario.id}`);
    ids.add(scenario.id);
  }

  const catalogsByStudio = new Map();
  for (const studio of [...new Set(scenarios.map((scenario) => scenario.studio))]) {
    catalogsByStudio.set(studio, await loadCatalog({ studio, catalogDir }));
  }

  const rows = [];
  for (const scenario of scenarios) {
    const catalog = catalogsByStudio.get(scenario.studio);
    const results = searchCatalog(catalog, scenario.prompt, { limit: scenario.limit ?? limit });
    const candidateCards = buildRerankCandidateCards(results);
    const candidateLeaks = countPrivateFieldLeaks(candidateCards);
    const rerank = await rerankImpl({
      query: scenario.prompt,
      candidateCards,
      scenario,
      ...rerankOptions
    });
    const rerankLeaks = countPrivateFieldLeaks(rerank?.candidateCards);
    const deterministicNames = results.map((result) => result.name);
    const shadowNames = rerank?.status === "completed"
      ? (rerank.ranked ?? []).map((entry) => entry.name)
      : [];

    rows.push({
      id: scenario.id,
      studio: scenario.studio,
      prompt: scenario.prompt,
      expectedSkill: scenario.expectedSkill,
      overlapCluster: scenario.overlapCluster ?? null,
      deterministic: {
        rank: rankOfNames(deterministicNames, scenario.expectedSkill),
        topResults: compactResults(results)
      },
      rerank: {
        provider: rerank?.provider ?? "voyage",
        mode: rerank?.mode ?? "shadow",
        status: rerank?.status ?? "failed",
        model: rerank?.model ?? null,
        inputCount: rerank?.inputCount ?? candidateCards.length,
        selectedSkillWouldChange: rerank?.selectedSkillWouldChange ?? null,
        error: rerank?.error ?? null,
        ranked: rerank?.ranked ?? []
      },
      shadow: {
        rank: shadowNames.length ? rankOfNames(shadowNames, scenario.expectedSkill) : null,
        topResults: rerank?.ranked ?? []
      },
      privacy: {
        candidateBodyLeaks: candidateLeaks.body,
        candidateReadPathLeaks: candidateLeaks.readPath,
        rerankBodyLeaks: rerankLeaks.body,
        rerankReadPathLeaks: rerankLeaks.readPath
      }
    });
  }

  return {
    suite: SUITE,
    rows
  };
}

function parseCliArgs(argv) {
  const [scenarioPath, ...rest] = argv;
  const options = {
    scenarioPath,
    summaryOnly: false,
    reportPath: null,
    catalogDir: defaultCatalogDir()
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];

    if (arg === "--summary") {
      options.summaryOnly = true;
    } else if (arg === "--report") {
      if (!next || next.startsWith("--")) throw new Error("--report requires a path");
      options.reportPath = next;
      index += 1;
    } else if (arg === "--catalog-dir") {
      if (!next || next.startsWith("--")) throw new Error("--catalog-dir requires a path");
      options.catalogDir = pathToFileURL(path.resolve(next));
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
    console.error("Usage: node src/eval-rerank.mjs evals/rerank-quality/v0/scenarios.json [--summary] [--report PATH] [--catalog-dir PATH]");
    process.exitCode = 2;
    return;
  }
  if (!options.scenarioPath) {
    console.error("Usage: node src/eval-rerank.mjs evals/rerank-quality/v0/scenarios.json [--summary] [--report PATH] [--catalog-dir PATH]");
    process.exitCode = 2;
    return;
  }

  const result = await runRerankQualityEval(options.scenarioPath, {
    catalogDir: options.catalogDir
  });
  const report = buildRerankEvalReport(result);
  const output = options.summaryOnly
    ? {
        suite: report.suite,
        scenarioCount: report.scenarioCount,
        statusCounts: report.statusCounts,
        metrics: report.metrics,
        privacy: report.privacy,
        promotion: report.promotion,
        thresholdFailures: report.thresholdFailures,
        proofBoundary: report.proofBoundary
      }
    : report;

  if (options.reportPath) await writeReport(options.reportPath, report);
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
