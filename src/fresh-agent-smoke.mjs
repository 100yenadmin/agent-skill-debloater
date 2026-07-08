import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parsePackReadPath, loadCatalog, searchCatalog } from "./search.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUITE = "fresh-agent-smokes/v0";
const DEFAULT_LIMIT = 3;
const DEFAULT_ENGINE = "json";
const ALL_STUDIOS = ["design", "marketing", "ceo", "engineering"];
const REQUIRED_KINDS = ["positive", "ambiguity", "hard-negative"];
const REQUIRED_POSITIVE_STUDIOS = [...ALL_STUDIOS].sort();
const DISPOSITIONS = ["select", "clarify", "abstain"];
const ROUTER_AMBIGUITY_RATIO = 0.7;
const BODY_FIELD_NAMES = new Set(["body", "rawBody", "skillBody", "skillMarkdown", "content", "instructions", "markdown"]);
const ROUTER_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "this",
  "to",
  "with"
]);
const PROOF_BOUNDARY =
  "Fresh-agent smokes prove router/search/read-path behavior locally only; they do not prove customer VM rollout readiness, OpenClaw core runtime safety, fleet deployment safety, or npm publication.";

function toPath(input) {
  if (input instanceof URL) return fileURLToPath(input);
  if (typeof input !== "string") {
    throw new TypeError("scenarioPath must be a string path or file URL");
  }
  if (input.startsWith("file:")) return fileURLToPath(input);
  return input;
}

function optionValue(name, value) {
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function routerForStudio(studio) {
  return `${studio}-studio`;
}

function searchCommand(studio, query) {
  return `node bin/debloat-skill-search ${studio} ${JSON.stringify(query)} --format json --limit ${DEFAULT_LIMIT} --engine ${DEFAULT_ENGINE}`;
}

function normalizeRouterToken(token) {
  return token
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/ies$/, "y")
    .replace(/s$/, "");
}

function stemRouterToken(token) {
  return token
    .replace(/ing$/, "")
    .replace(/ed$/, "")
    .replace(/e$/, "");
}

function routerTokens(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeRouterToken)
    .filter((token) => token.length > 1 && !ROUTER_STOP_WORDS.has(token));
}

function routerTokenMatches(tokens, queryToken) {
  const queryStem = stemRouterToken(queryToken);
  return tokens.some((token) => {
    const tokenStem = stemRouterToken(token);
    return (
      token === queryToken ||
      token.startsWith(queryToken) ||
      (queryStem.length > 3 && tokenStem === queryStem)
    );
  });
}

function routerDescription(routerBody) {
  return routerBody.match(/^description:\s*(.+)$/m)?.[1] ?? "";
}

function scoreRouterDescription(routerBody, prompt) {
  const promptTokens = routerTokens(prompt);
  const descriptionTokens = routerTokens(routerDescription(routerBody));
  return promptTokens.reduce(
    (score, token) => score + (routerTokenMatches(descriptionTokens, token) ? 12 : 0),
    0
  );
}

function compactResult(result) {
  return {
    name: result.name,
    title: result.title,
    studio: result.studio,
    source: result.source,
    pack: result.pack,
    capabilities: result.capabilities,
    skillPath: result.skillPath,
    readPath: result.readPath,
    confidence: result.confidence,
    confidenceLabel: result.confidenceLabel,
    why: result.why
  };
}

function selectedTrace(result) {
  if (!result) return null;
  return {
    name: result.name,
    title: result.title,
    studio: result.studio,
    source: result.source,
    pack: result.pack,
    capabilities: result.capabilities,
    skillPath: result.skillPath,
    readPath: result.readPath,
    sourceCommit: result.sourceCommit,
    sourceUrl: result.sourceUrl,
    confidence: result.confidence,
    confidenceLabel: result.confidenceLabel,
    why: result.why
  };
}

function findBodyFields(value, prefix = "$") {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findBodyFields(item, `${prefix}[${index}]`));
  }
  const found = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${prefix}.${key}`;
    if (BODY_FIELD_NAMES.has(key)) found.push(childPath);
    found.push(...findBodyFields(child, childPath));
  }
  return found;
}

function isValidPackSkillReadPath(readPath) {
  if (typeof readPath !== "string") return false;
  try {
    const { skillPath } = parsePackReadPath(readPath);
    if (!skillPath.endsWith("/SKILL.md")) return false;
    if (path.isAbsolute(skillPath) || path.win32.isAbsolute(skillPath)) return false;
    if (skillPath.includes("\\")) return false;
    const normalized = path.posix.normalize(skillPath);
    return normalized === skillPath && normalized !== ".." && !normalized.startsWith("../");
  } catch {
    return false;
  }
}

function validateScenario(scenario, index) {
  const label = scenario.id ?? `scenario[${index}]`;
  if (!scenario.id) throw new Error(`Fresh-agent smoke scenario[${index}] is missing id`);
  if (!REQUIRED_KINDS.includes(scenario.kind)) {
    throw new Error(`Fresh-agent smoke ${label} kind must be one of ${REQUIRED_KINDS.join(", ")}`);
  }
  if (typeof scenario.prompt !== "string" || !scenario.prompt.trim()) {
    throw new Error(`Fresh-agent smoke ${label} is missing prompt`);
  }
  if (scenario.kind === "hard-negative") {
    if (scenario.expectedSelectedStudio !== null) {
      throw new Error(`Fresh-agent smoke ${label} hard-negative expectedSelectedStudio must be null`);
    }
    if (!Array.isArray(scenario.studios) || scenario.studios.length === 0) {
      throw new Error(`Fresh-agent smoke ${label} hard-negative requires studios`);
    }
    if (scenario.expectedDisposition && scenario.expectedDisposition !== "abstain") {
      throw new Error(`Fresh-agent smoke ${label} hard-negative expectedDisposition must be abstain`);
    }
    return;
  }
  for (const field of ["studio", "expectedRouter", "expectedSkill", "expectedReadPath"]) {
    if (typeof scenario[field] !== "string" || !scenario[field]) {
      throw new Error(`Fresh-agent smoke ${label} is missing ${field}`);
    }
  }
  if (scenario.query !== undefined && (typeof scenario.query !== "string" || !scenario.query)) {
    throw new Error(`Fresh-agent smoke ${label} query must be a non-empty string when provided`);
  }
  if (scenario.expectedDisposition && !DISPOSITIONS.includes(scenario.expectedDisposition)) {
    throw new Error(`Fresh-agent smoke ${label} expectedDisposition must be one of ${DISPOSITIONS.join(", ")}`);
  }
  if (!Array.isArray(scenario.expectedCapabilities) || scenario.expectedCapabilities.length === 0) {
    throw new Error(`Fresh-agent smoke ${label} expectedCapabilities must be a non-empty array`);
  }
  if (scenario.expectedRouter !== routerForStudio(scenario.studio)) {
    throw new Error(`Fresh-agent smoke ${label} expectedRouter must match studio`);
  }
}

async function readRouterSkill(studio) {
  const router = routerForStudio(studio);
  return readFile(path.join(repoRoot, "skills", router, "SKILL.md"), "utf8");
}

async function runSearch(studio, query, options = {}) {
  const { catalogDir, searchImpl } = options;
  if (searchImpl) {
    return searchImpl({
      studio,
      query,
      catalogDir,
      limit: DEFAULT_LIMIT,
      engine: DEFAULT_ENGINE
    });
  }
  const catalog = await loadCatalog({ studio, catalogDir });
  return searchCatalog(catalog, query, {
    limit: DEFAULT_LIMIT,
    engine: DEFAULT_ENGINE
  });
}

async function selectRouterFromPrompt(prompt, options) {
  const candidates = [];
  for (const studio of ALL_STUDIOS) {
    const [routerBody, results] = await Promise.all([
      readRouterSkill(studio),
      runSearch(studio, prompt, options)
    ]);
    const topResult = results[0] ?? null;
    if (!topResult) continue;
    const routerScore = scoreRouterDescription(routerBody, prompt);
    candidates.push({
      studio,
      router: routerForStudio(studio),
      score: (topResult.score ?? 0) + routerScore,
      catalogScore: topResult.score ?? 0,
      routerScore,
      confidenceLabel: topResult.confidenceLabel,
      topResult: compactResult(topResult)
    });
  }
  candidates.sort((left, right) => right.score - left.score || left.studio.localeCompare(right.studio));
  if (candidates.length === 0) {
    return {
      disposition: "abstain",
      selectedStudio: null,
      selectedRouter: null,
      candidates
    };
  }
  const [top, second] = candidates;
  const hasMeaningfulConflict =
    top.confidenceLabel === "high" &&
    second?.confidenceLabel === "high" &&
    second.score / top.score >= ROUTER_AMBIGUITY_RATIO;
  if (hasMeaningfulConflict) {
    return {
      disposition: "clarify",
      selectedStudio: null,
      selectedRouter: null,
      candidates
    };
  }
  return {
    disposition: "select",
    selectedStudio: top.studio,
    selectedRouter: top.router,
    candidates
  };
}

async function runPositiveScenario(scenario, options) {
  const routerBody = await readRouterSkill(scenario.studio);
  const expectedDisposition = scenario.expectedDisposition ?? (scenario.kind === "ambiguity" ? "clarify" : "select");
  const routerDecision = await selectRouterFromPrompt(scenario.prompt, options);
  const results = await runSearch(scenario.studio, scenario.prompt, options);
  const rawTopResults = results.slice(0, DEFAULT_LIMIT);
  const topResults = rawTopResults.map(compactResult);
  const candidate = results[0] ?? null;
  const selected =
    expectedDisposition === "select" && routerDecision.disposition === "select"
      ? candidate
      : null;
  const traceTarget = selected ?? candidate;
  const bodyFields = findBodyFields(rawTopResults);
  const readPathFailures = topResults.map((result) => result.readPath).filter((readPath) => !isValidPackSkillReadPath(readPath));
  const failures = [];
  if (!routerBody.includes(`debloat-skill-search" ${scenario.studio}`)) failures.push("router-does-not-run-studio-search");
  if (!/Never paste or summarize the whole .*catalog into the prompt\./.test(routerBody)) {
    failures.push("router-missing-whole-pack-warning");
  }
  if (routerDecision.disposition !== expectedDisposition) failures.push("router-disposition");
  if (expectedDisposition === "select" && routerDecision.selectedRouter !== scenario.expectedRouter) {
    failures.push("router-selection");
  }
  if (expectedDisposition === "select" && routerDecision.selectedStudio !== scenario.studio) {
    failures.push("router-studio");
  }
  if (expectedDisposition === "clarify" && routerDecision.selectedRouter !== null) {
    failures.push("router-should-clarify");
  }
  if (traceTarget?.name !== scenario.expectedSkill) failures.push("selected-skill");
  if (traceTarget?.readPath !== scenario.expectedReadPath) failures.push("selected-read-path");
  for (const capability of scenario.expectedCapabilities) {
    if (!traceTarget?.capabilities?.includes(capability)) failures.push(`missing-capability:${capability}`);
  }
  if (bodyFields.length > 0) failures.push("body-field-leak");
  if (readPathFailures.length > 0) failures.push("invalid-read-path");

  const row = {
    id: scenario.id,
    kind: scenario.kind,
    prompt: scenario.prompt,
    query: scenario.prompt,
    expectedDisposition,
    routerDecision,
    selectedRouter: routerDecision.selectedRouter,
    selectedStudio: routerDecision.selectedStudio,
    searchCommand: searchCommand(scenario.studio, scenario.prompt),
    top3Inspected: topResults.length <= DEFAULT_LIMIT,
    topResults,
    selectedSkillTrace: selectedTrace(selected),
    candidateSkillTrace: selectedTrace(candidate),
    sourceCapabilityDisclosure: selected
      ? {
          source: selected.source,
          capabilities: selected.capabilities
        }
      : candidate
        ? {
            source: candidate.source,
            capabilities: candidate.capabilities
          }
        : null,
    chosenReadPath: selected?.readPath ?? null,
    candidateReadPath: candidate?.readPath ?? null,
    wholePackLoaded: bodyFields.length > 0,
    bodyLeakFields: bodyFields,
    invalidReadPaths: readPathFailures,
    failures
  };

  if (scenario.kind === "ambiguity") {
    row.alternateRouterResults = [];
    for (const alternateStudio of scenario.alternateStudios ?? []) {
      const alternateResults = await runSearch(alternateStudio, scenario.prompt, options);
      row.alternateRouterResults.push({
        studio: alternateStudio,
        router: routerForStudio(alternateStudio),
        searchCommand: searchCommand(alternateStudio, scenario.prompt),
        topResults: alternateResults.slice(0, DEFAULT_LIMIT).map(compactResult)
      });
    }
    if (row.alternateRouterResults.length === 0) failures.push("missing-alternate-router-results");
    if (row.alternateRouterResults.some((entry) => entry.topResults.length === 0)) {
      failures.push("empty-alternate-router-results");
    }
  }

  row.ok = failures.length === 0;
  return row;
}

async function runHardNegativeScenario(scenario, options) {
  const studios = scenario.studios ?? ALL_STUDIOS;
  const routerDecision = await selectRouterFromPrompt(scenario.prompt, options);
  const searchedStudios = [];
  const bodyFields = [];
  const invalidReadPaths = [];
  for (const studio of studios) {
    const results = await runSearch(studio, scenario.prompt, options);
    const rawTopResults = results.slice(0, DEFAULT_LIMIT);
    bodyFields.push(...findBodyFields(rawTopResults).map((field) => `${studio}:${field}`));
    invalidReadPaths.push(
      ...rawTopResults
        .map((result) => result.readPath)
        .filter((readPath) => !isValidPackSkillReadPath(readPath))
        .map((readPath) => `${studio}:${readPath}`)
    );
    searchedStudios.push({
      studio,
      router: routerForStudio(studio),
      searchCommand: searchCommand(studio, scenario.prompt),
      topResults: rawTopResults.map(compactResult)
    });
  }
  const falsePositiveStudios = searchedStudios
    .filter((entry) => entry.topResults.length > 0)
    .map((entry) => entry.studio);
  const failures = [];
  if (routerDecision.disposition !== "abstain") failures.push("router-disposition");
  if (falsePositiveStudios.length > 0) failures.push("hard-negative-false-positive");
  if (bodyFields.length > 0) failures.push("body-field-leak");
  if (invalidReadPaths.length > 0) failures.push("invalid-read-path");
  return {
    id: scenario.id,
    kind: scenario.kind,
    prompt: scenario.prompt,
    expectedDisposition: "abstain",
    routerDecision,
    selectedRouter: null,
    selectedStudio: null,
    searchedStudios,
    falsePositiveStudios,
    top3Inspected: true,
    selectedSkillTrace: null,
    sourceCapabilityDisclosure: null,
    chosenReadPath: null,
    wholePackLoaded: bodyFields.length > 0,
    bodyLeakFields: bodyFields,
    invalidReadPaths,
    failures,
    ok: failures.length === 0
  };
}

export async function runFreshAgentSmokes(scenarioPath, options = {}) {
  const absoluteScenarioPath = path.resolve(toPath(scenarioPath));
  const scenarios = JSON.parse(await readFile(absoluteScenarioPath, "utf8"));
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    throw new Error("Fresh-agent smoke suite requires at least one scenario");
  }
  const seen = new Set();
  scenarios.forEach((scenario, index) => {
    validateScenario(scenario, index);
    if (seen.has(scenario.id)) throw new Error(`Fresh-agent smoke id must be unique: ${scenario.id}`);
    seen.add(scenario.id);
  });

  const rows = [];
  for (const scenario of scenarios) {
    rows.push(
      scenario.kind === "hard-negative"
        ? await runHardNegativeScenario(scenario, options)
        : await runPositiveScenario(scenario, options)
    );
  }

  return {
    suite: SUITE,
    scenarioPath: path.relative(repoRoot, absoluteScenarioPath),
    rows
  };
}

function requiredCoverage(rows) {
  const kinds = [...new Set(rows.map((row) => row.kind))];
  const positiveStudios = [...new Set(rows
    .filter((row) => row.kind === "positive" && row.ok)
    .map((row) => row.selectedStudio ?? row.routerDecision?.selectedStudio)
    .filter(Boolean))].sort();
  return {
    requiredKinds: REQUIRED_KINDS,
    presentKinds: kinds.sort(),
    missingKinds: REQUIRED_KINDS.filter((kind) => !kinds.includes(kind)),
    requiredPositiveStudios: REQUIRED_POSITIVE_STUDIOS,
    presentPositiveStudios: positiveStudios,
    missingPositiveStudios: REQUIRED_POSITIVE_STUDIOS.filter((studio) => !positiveStudios.includes(studio))
  };
}

function metrics(rows) {
  const passCount = rows.filter((row) => row.ok).length;
  const hardNegativeFalsePositiveCount = rows
    .filter((row) => row.kind === "hard-negative")
    .reduce((total, row) => total + (row.falsePositiveStudios?.length ?? 0), 0);
  return {
    passCount,
    failCount: rows.length - passCount,
    passRate: rows.length === 0 ? 0 : passCount / rows.length,
    hardNegativeFalsePositiveCount
  };
}

export function buildFreshAgentSmokeReport(result) {
  const coverage = requiredCoverage(result.rows);
  const summary = metrics(result.rows);
  const thresholdFailures = [];
  if (coverage.missingKinds.length > 0) thresholdFailures.push("missing-required-kinds");
  if (coverage.missingPositiveStudios.length > 0) thresholdFailures.push("missing-positive-studios");
  if (summary.passRate < 1) thresholdFailures.push("pass-rate");
  if (summary.hardNegativeFalsePositiveCount > 0) thresholdFailures.push("hard-negative-false-positive");

  return {
    ok: thresholdFailures.length === 0,
    suite: result.suite,
    scenarioCount: result.rows.length,
    metrics: summary,
    requiredCoverage: coverage,
    thresholdFailures,
    rows: result.rows,
    proofBoundary: PROOF_BOUNDARY
  };
}

function usage() {
  return [
    "Usage: node src/fresh-agent-smoke.mjs <scenario-path> [--summary] [--report PATH]",
    "",
    "Runs fresh-agent-smokes/v0 and emits JSON by default."
  ].join("\n");
}

export async function freshAgentSmokeMain(argv) {
  const [scenarioPath, ...rest] = argv;
  if (!scenarioPath || scenarioPath.startsWith("--")) {
    console.error(usage());
    return 2;
  }

  let summary = false;
  let reportPath = null;
  try {
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index];
      const next = rest[index + 1];
      if (arg === "--summary") {
        summary = true;
      } else if (arg === "--report") {
        reportPath = optionValue("--report", next);
        index += 1;
      } else {
        throw new Error(`Unknown argument: ${arg}`);
      }
    }
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }

  const report = buildFreshAgentSmokeReport(await runFreshAgentSmokes(scenarioPath));
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (reportPath) {
    await writeFile(reportPath, json);
  }
  if (summary) {
    console.log(
      `${report.suite}: ok=${report.ok} scenarios=${report.scenarioCount} passRate=${report.metrics.passRate} hardNegativeFalsePositives=${report.metrics.hardNegativeFalsePositiveCount}`
    );
  } else {
    console.log(json.trimEnd());
  }
  return report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  freshAgentSmokeMain(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
