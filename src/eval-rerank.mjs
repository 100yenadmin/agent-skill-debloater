import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildRerankCandidateCards,
  defaultCatalogDir,
  loadCatalog,
  runJevRerank,
  runVoyageRerank,
  searchCatalog
} from "./search.mjs";

const SUITE = "rerank-quality/v0";
const PROVIDER_IMPLS = {
  voyage: runVoyageRerank,
  jev: runJevRerank
};
const DEFAULT_PROVIDER = "voyage";
const DEFAULT_LIMIT = 5;
const THRESHOLDS = {
  promotionMrrAt3Gain: 0.05,
  promotionTop1Gain: 0.05,
  maxRecallAt3Loss: 0,
  privacyLeakCount: 0
};
const PROOF_BOUNDARY =
  "Rerank quality evals are advisory shadow evidence only; they do not promote Voyage ordering or Jev picks.";

function toPath(input) {
  if (input instanceof URL) return fileURLToPath(input);
  if (typeof input !== "string") {
    throw new TypeError("scenarioPath must be a string path or file URL");
  }
  if (input.startsWith("file:")) return fileURLToPath(input);
  return input;
}

function suiteFor(scenarioPath) {
  const match = toPath(scenarioPath).split(path.sep).join("/").match(/rerank-quality\/(v\d+)\/[^/]+$/);
  return match ? `rerank-quality/${match[1]}` : SUITE;
}

// A scenario with `expectedSkill: null` is a hard negative: no skill should be selected.
function validateScenario(scenario) {
  for (const field of ["id", "studio", "prompt"]) {
    if (typeof scenario[field] !== "string" || scenario[field].length === 0) {
      throw new Error(`Rerank scenario ${scenario.id ?? "<unknown>"} ${field} must be a non-empty string`);
    }
  }
  if (scenario.expectedSkill !== null && (typeof scenario.expectedSkill !== "string" || scenario.expectedSkill.length === 0)) {
    throw new Error(`Rerank scenario ${scenario.id ?? "<unknown>"} expectedSkill must be a non-empty string or null`);
  }
}

function rankOfNames(names, expectedSkill) {
  const index = names.indexOf(expectedSkill);
  return index === -1 ? null : index + 1;
}

// Providers that can abstain (Jev) rank "none" among the candidates by its probability, so an
// abstention on a positive scenario pushes the expected skill down one place.
function shadowNames(rerank) {
  if (rerank?.status !== "completed") return [];
  const ranked = rerank.ranked ?? [];
  const names = ranked.map((entry) => entry.name);
  if (typeof rerank.abstained !== "boolean") return names;
  const noneAt = rerank.abstained
    ? 0
    : ranked.filter((entry) => (entry.probability ?? -1) >= (rerank.noneProbability ?? -1)).length;
  names.splice(noneAt, 0, null);
  return names;
}

function latencySummary(values) {
  if (values.length === 0) return { count: 0, p50: null, p95: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] };
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

function statusCounts(entries) {
  const counts = {};
  for (const entry of entries) {
    counts[entry.rerank.status] = (counts[entry.rerank.status] ?? 0) + 1;
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

function sumPrivacy(entries) {
  return entries.reduce(
    (acc, entry) => ({
      candidateBodyLeaks: acc.candidateBodyLeaks + entry.privacy.candidateBodyLeaks,
      candidateReadPathLeaks: acc.candidateReadPathLeaks + entry.privacy.candidateReadPathLeaks,
      rerankBodyLeaks: acc.rerankBodyLeaks + entry.privacy.rerankBodyLeaks,
      rerankReadPathLeaks: acc.rerankReadPathLeaks + entry.privacy.rerankReadPathLeaks
    }),
    {
      candidateBodyLeaks: 0,
      candidateReadPathLeaks: 0,
      rerankBodyLeaks: 0,
      rerankReadPathLeaks: 0
    }
  );
}

function negativeSummary(flags) {
  const correct = flags.filter(Boolean).length;
  return { count: flags.length, correct, accuracy: flags.length ? correct / flags.length : null };
}

function providerReport(rows, name) {
  const entries = rows.map((row) => ({ row, ...row.providers[name] }));
  const positives = entries.filter((entry) => !entry.row.negative);
  const completedRows = positives.filter((entry) => entry.rerank.status === "completed");
  const deterministicCompleted = rankMetrics(completedRows.map((entry) => entry.row.deterministic.rank));
  const shadowCompleted = rankMetrics(completedRows.map((entry) => entry.shadow.rank));
  const privacy = sumPrivacy(entries);
  const completed = entries.filter((entry) => entry.rerank.status === "completed");
  const usageRows = completed.filter((entry) => entry.rerank.usage);

  return {
    statusCounts: statusCounts(entries),
    metrics: { deterministicCompleted, shadowCompleted },
    negatives: negativeSummary(entries.filter((entry) => entry.row.negative).map((entry) => entry.negativeCorrect)),
    wouldChangeTop1Count: completed.filter((entry) => entry.rerank.selectedSkillWouldChange === true).length,
    abstainedCount: completed.filter((entry) => entry.rerank.abstained === true).length,
    latencyMs: latencySummary(completed.map((entry) => entry.latencyMs)),
    ...(usageRows.length
      ? {
          usage: {
            inputTokens: usageRows.reduce((sum, entry) => sum + (entry.rerank.usage.inputTokens ?? 0), 0),
            outputTokens: usageRows.reduce((sum, entry) => sum + (entry.rerank.usage.outputTokens ?? 0), 0)
          }
        }
      : {}),
    privacy,
    promotion: promotionDecision({ completedRows, deterministicCompleted, shadowCompleted, privacy })
  };
}

export function buildRerankEvalReport(result) {
  const providerNames = result.providers ?? [DEFAULT_PROVIDER];
  const providers = Object.fromEntries(providerNames.map((name) => [name, providerReport(result.rows, name)]));
  const primary = providers[providerNames[0]];
  const positives = result.rows.filter((row) => !row.negative);
  const negatives = result.rows.filter((row) => row.negative);
  const thresholdFailures = [];
  if (Object.values(providers).some((report) => report.promotion.reasons.includes("privacy-leak"))) {
    thresholdFailures.push("privacy-leak");
  }

  return {
    suite: result.suite ?? SUITE,
    scenarioCount: result.rows.length,
    positiveCount: positives.length,
    negativeCount: negatives.length,
    candidateLimit: result.candidateLimit ?? DEFAULT_LIMIT,
    thresholds: THRESHOLDS,
    statusCounts: primary.statusCounts,
    metrics: {
      deterministic: rankMetrics(positives.map((row) => row.deterministic.rank)),
      deterministicCompleted: primary.metrics.deterministicCompleted,
      shadowCompleted: primary.metrics.shadowCompleted
    },
    deterministicNegatives: negativeSummary(negatives.map((row) => row.deterministic.negativeCorrect)),
    privacy: primary.privacy,
    promotion: primary.promotion,
    providers,
    thresholdFailures,
    proofBoundary: PROOF_BOUNDARY,
    rows: result.rows
  };
}

function resolveProviders({ providers, rerankImpl, rerankOptions }) {
  if (!providers) return [[DEFAULT_PROVIDER, { impl: rerankImpl, options: rerankOptions }]];
  const list = Array.isArray(providers) ? providers.map((name) => [name, {}]) : Object.entries(providers);
  if (list.length === 0) throw new Error("Rerank eval requires at least one provider");
  return list.map(([name, spec]) => {
    const impl = typeof spec === "function" ? spec : spec?.impl ?? PROVIDER_IMPLS[name];
    if (typeof impl !== "function") throw new Error(`Unknown rerank provider: ${name}`);
    return [name, { impl, options: typeof spec === "function" ? {} : spec?.options ?? {} }];
  });
}

async function runProvider(impl, options, { query, candidateCards, deterministicEmpty }) {
  const startedAt = performance.now();
  // Scorers receive the query and compact candidate cards only, never the scenario or its label.
  const rerank = await impl({ ...options, query, candidateCards });
  const latencyMs = Number((performance.now() - startedAt).toFixed(1));
  const rerankLeaks = countPrivateFieldLeaks(rerank?.candidateCards);
  const candidateLeaks = countPrivateFieldLeaks(candidateCards);
  const status = rerank?.status ?? "failed";

  return {
    rerank: {
      provider: rerank?.provider ?? null,
      mode: rerank?.mode ?? "shadow",
      status,
      model: rerank?.model ?? null,
      inputCount: rerank?.inputCount ?? candidateCards.length,
      selectedSkillWouldChange: rerank?.selectedSkillWouldChange ?? null,
      error: rerank?.error ?? null,
      ranked: rerank?.ranked ?? [],
      ...(typeof rerank?.abstained === "boolean" || rerank?.provider === "jev"
        ? {
            choice: rerank?.choice ?? null,
            confidence: rerank?.confidence ?? null,
            noneProbability: rerank?.noneProbability ?? null,
            abstained: rerank?.abstained ?? null
          }
        : {}),
      ...(rerank?.usage ? { usage: rerank.usage } : {})
    },
    shadowNames: shadowNames(rerank),
    latencyMs,
    negativeCorrect: deterministicEmpty || (status === "completed" && rerank?.abstained === true),
    privacy: {
      candidateBodyLeaks: candidateLeaks.body,
      candidateReadPathLeaks: candidateLeaks.readPath,
      rerankBodyLeaks: rerankLeaks.body,
      rerankReadPathLeaks: rerankLeaks.readPath
    }
  };
}

export async function runRerankQualityEval(
  scenarioPath,
  {
    catalogDir = defaultCatalogDir(),
    limit = DEFAULT_LIMIT,
    rerankImpl = runVoyageRerank,
    rerankOptions = {},
    providers
  } = {}
) {
  const providerSpecs = resolveProviders({ providers, rerankImpl, rerankOptions });
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
    const negative = scenario.expectedSkill === null;
    const deterministicNames = results.map((result) => result.name);
    const providerRows = {};

    for (const [name, spec] of providerSpecs) {
      const run = await runProvider(spec.impl, spec.options, {
        query: scenario.prompt,
        candidateCards,
        deterministicEmpty: results.length === 0
      });
      providerRows[name] = {
        rerank: { ...run.rerank, provider: run.rerank.provider ?? name },
        shadow: {
          rank: !negative && run.shadowNames.length ? rankOfNames(run.shadowNames, scenario.expectedSkill) : null,
          topResults: run.rerank.ranked
        },
        latencyMs: run.latencyMs,
        negativeCorrect: negative ? run.negativeCorrect : null,
        privacy: run.privacy
      };
    }
    const primary = providerRows[providerSpecs[0][0]];

    rows.push({
      id: scenario.id,
      studio: scenario.studio,
      prompt: scenario.prompt,
      expectedSkill: scenario.expectedSkill,
      negative,
      overlapCluster: scenario.overlapCluster ?? null,
      ...(scenario.provenance ? { provenance: scenario.provenance } : {}),
      deterministic: {
        rank: negative ? null : rankOfNames(deterministicNames, scenario.expectedSkill),
        negativeCorrect: negative ? results.length === 0 : null,
        topResults: compactResults(results)
      },
      rerank: primary.rerank,
      shadow: primary.shadow,
      privacy: primary.privacy,
      providers: providerRows
    });
  }

  return {
    suite: suiteFor(scenarioPath),
    candidateLimit: limit,
    providers: providerSpecs.map(([name]) => name),
    rows
  };
}

const USAGE =
  "Usage: node src/eval-rerank.mjs [SCENARIOS] [--scenarios PATH] [--providers voyage,jev] [--candidate-limit N] " +
  "[--summary] [--report PATH] [--catalog-dir PATH]";

export function parseRerankEvalArgs(argv) {
  const options = {
    scenarioPath: null,
    summaryOnly: false,
    reportPath: null,
    catalogDir: defaultCatalogDir(),
    providers: [DEFAULT_PROVIDER],
    candidateLimit: DEFAULT_LIMIT
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

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
    } else if (arg === "--scenarios") {
      if (!next || next.startsWith("--")) throw new Error("--scenarios requires a path");
      options.scenarioPath = next;
      index += 1;
    } else if (arg === "--providers") {
      if (!next || next.startsWith("--")) throw new Error("--providers requires a comma-separated list");
      const names = next.split(",").map((name) => name.trim()).filter(Boolean);
      const unknown = names.filter((name) => !Object.hasOwn(PROVIDER_IMPLS, name));
      if (names.length === 0 || unknown.length > 0) {
        throw new Error(`--providers must list known providers (${Object.keys(PROVIDER_IMPLS).join(", ")})`);
      }
      options.providers = [...new Set(names)];
      index += 1;
    } else if (arg === "--candidate-limit") {
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed < 1) throw new Error("--candidate-limit must be a positive integer");
      options.candidateLimit = parsed;
      index += 1;
    } else if (!arg.startsWith("--") && options.scenarioPath === null) {
      options.scenarioPath = arg;
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
    options = parseRerankEvalArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  if (!options.scenarioPath) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  const result = await runRerankQualityEval(options.scenarioPath, {
    catalogDir: options.catalogDir,
    limit: options.candidateLimit,
    providers: options.providers
  });
  const report = buildRerankEvalReport(result);
  const output = options.summaryOnly
    ? {
        suite: report.suite,
        scenarioCount: report.scenarioCount,
        positiveCount: report.positiveCount,
        negativeCount: report.negativeCount,
        candidateLimit: report.candidateLimit,
        statusCounts: report.statusCounts,
        metrics: report.metrics,
        deterministicNegatives: report.deterministicNegatives,
        privacy: report.privacy,
        promotion: report.promotion,
        providers: report.providers,
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
