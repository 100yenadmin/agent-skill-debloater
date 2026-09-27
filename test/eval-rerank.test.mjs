import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import { buildRerankEvalReport, parseRerankEvalArgs, runRerankQualityEval } from "../src/eval-rerank.mjs";

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
  assert.equal(report.scenarioCount, 6);
  assert.equal(report.statusCounts["skipped-missing-api-key"], 6);
  assert.equal(report.metrics.deterministic.count, 6);
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
  assert.equal(summary.statusCounts["skipped-missing-api-key"], 6);
  assert.equal(report.rows.length, 6);
  assert.equal(report.proofBoundary.includes("do not promote Voyage ordering"), true);
});

function rankedFrom(candidateCards, names) {
  return names.map((name, index) => {
    const original = candidateCards.findIndex((card) => card.name === name);
    return {
      rank: index + 1,
      index: original,
      originalRank: original + 1,
      name,
      source: candidateCards[original].source,
      skillPath: candidateCards[original].skillPath,
      probability: 1 - index / 10
    };
  });
}

function stubProvider(provider, pick) {
  const calls = [];
  const impl = async (args) => {
    calls.push(args);
    const { candidateCards } = args;
    const choice = pick(args);
    const names = candidateCards.map((card) => card.name);
    const ordered = choice && choice !== "none" ? [choice, ...names.filter((name) => name !== choice)] : [...names].reverse();
    return {
      provider,
      mode: "shadow",
      status: candidateCards.length ? "completed" : "skipped-empty-candidates",
      model: `${provider}-fixture`,
      inputCount: candidateCards.length,
      candidateCards,
      ranked: candidateCards.length ? rankedFrom(candidateCards, ordered) : [],
      selectedSkillWouldChange: choice !== names[0],
      ...(provider === "jev"
        ? { choice: choice ?? null, abstained: candidateCards.length ? choice === "none" : null, noneProbability: choice === "none" ? 0.9 : 0 }
        : {})
    };
  };
  return { impl, calls };
}

test("rerank eval scores several providers and never hands scorers the scenario label", async () => {
  const tmpRoot = new URL("./.test-tmp/eval-rerank-providers/", import.meta.url);
  await rm(tmpRoot, { force: true, recursive: true });
  await mkdir(tmpRoot, { recursive: true });
  const scenarioPath = new URL("scenarios.json", tmpRoot);
  await writeScenarios(scenarioPath, [
    { id: "pos-second", studio: "marketing", prompt: "write core offer launch copy", expectedSkill: "product-marketing" },
    { id: "neg-with-results", studio: "marketing", prompt: "launch copy", expectedSkill: null },
    { id: "neg-empty", studio: "marketing", prompt: "Translate a short French poem into English prose.", expectedSkill: null }
  ]);
  // voyage stub reverses the lexical order; jev stub picks product-marketing for the positive and abstains otherwise.
  const voyage = stubProvider("voyage", () => undefined);
  const jev = stubProvider("jev", ({ query }) => (query.includes("core offer") ? "product-marketing" : "none"));

  const result = await runRerankQualityEval(scenarioPath, {
    catalogDir: fixtureCatalogDir,
    providers: { voyage: voyage.impl, jev: jev.impl }
  });
  const report = buildRerankEvalReport(result);

  for (const call of [...voyage.calls, ...jev.calls]) {
    assert.deepEqual(Object.keys(call).sort(), ["candidateCards", "query"]);
    assert.doesNotMatch(JSON.stringify(call), /expectedSkill|pos-second|neg-with-results/);
  }
  assert.equal(report.positiveCount, 1);
  assert.equal(report.negativeCount, 2);
  assert.deepEqual(report.metrics.deterministic, { count: 1, recallAt3: 1, top1: 0, mrrAt3: 0.5 });
  assert.deepEqual(report.deterministicNegatives, { count: 2, correct: 1, accuracy: 0.5 });
  assert.equal(report.statusCounts, report.providers.voyage.statusCounts);
  assert.deepEqual(report.providers.voyage.metrics.shadowCompleted, { count: 1, recallAt3: 1, top1: 1, mrrAt3: 1 });
  assert.deepEqual(report.providers.voyage.negatives, { count: 2, correct: 1, accuracy: 0.5 });
  assert.deepEqual(report.providers.jev.metrics.shadowCompleted, { count: 1, recallAt3: 1, top1: 1, mrrAt3: 1 });
  assert.deepEqual(report.providers.jev.negatives, { count: 2, correct: 2, accuracy: 1 });
  assert.equal(report.providers.jev.abstainedCount, 1);
  assert.deepEqual(report.providers.jev.statusCounts, { completed: 2, "skipped-empty-candidates": 1 });
  assert.equal(report.providers.jev.promotion.eligible, true);
  assert.equal(report.providers.jev.promotion.deltas.top1, 1);
  assert.equal(report.rows[1].providers.jev.negativeCorrect, true);
  assert.equal(report.rows[1].providers.voyage.negativeCorrect, false);
  assert.equal(report.rows[0].providers.jev.shadow.rank, 1);
  assert.equal(typeof report.providers.jev.latencyMs.p50, "number");
  assert.deepEqual(report.thresholdFailures, []);
});

test("rerank eval ranks a Jev abstention on a positive scenario as the first option", async () => {
  const tmpRoot = new URL("./.test-tmp/eval-rerank-abstain/", import.meta.url);
  await rm(tmpRoot, { force: true, recursive: true });
  await mkdir(tmpRoot, { recursive: true });
  const scenarioPath = new URL("scenarios.json", tmpRoot);
  await writeScenarios(scenarioPath, [
    { id: "pos", studio: "marketing", prompt: "write core offer launch copy", expectedSkill: "launch" }
  ]);
  const jev = stubProvider("jev", () => "none");

  const report = buildRerankEvalReport(
    await runRerankQualityEval(scenarioPath, { catalogDir: fixtureCatalogDir, providers: { jev: jev.impl } })
  );

  // Abstained ordering is [none, product-marketing, launch]: "launch" falls to rank 3.
  assert.equal(report.rows[0].providers.jev.shadow.rank, 3);
  assert.equal(report.providers.jev.metrics.shadowCompleted.top1, 0);
  assert.ok(report.providers.jev.promotion.reasons.includes("insufficient-mrr-or-top1-gain"));
});

test("rerank-quality/v1 suite runs keyless with 45 positives and 5 labelled negatives", async () => {
  const scenarios = JSON.parse(await readFile(new URL("../evals/rerank-quality/v1/scenarios.json", import.meta.url), "utf8"));
  assert.equal(scenarios.length, 50);
  assert.ok(scenarios.every((scenario) => scenario.provenance?.source && scenario.provenance?.id === scenario.id));

  const report = buildRerankEvalReport(
    await runRerankQualityEval(new URL("../evals/rerank-quality/v1/scenarios.json", import.meta.url), {
      providers: { voyage: { options: { apiKey: "" } }, jev: { options: { apiKey: "" } } }
    })
  );

  assert.equal(report.suite, "rerank-quality/v1");
  assert.equal(report.positiveCount, 45);
  assert.equal(report.negativeCount, 5);
  assert.equal(report.providers.voyage.statusCounts["skipped-missing-api-key"], 45);
  assert.equal(report.providers.jev.statusCounts["skipped-missing-api-key"], 45);
  assert.equal(report.providers.jev.statusCounts["skipped-empty-candidates"], 5);
  assert.deepEqual(report.thresholdFailures, []);
});

test("rerank eval blocks promotion when a provider accepts more hard negatives than deterministic search", () => {
  const privacy = { candidateBodyLeaks: 0, candidateReadPathLeaks: 0, rerankBodyLeaks: 0, rerankReadPathLeaks: 0 };
  const completed = (rank) => ({ rerank: { status: "completed", selectedSkillWouldChange: false, abstained: false }, shadow: { rank }, privacy, latencyMs: 1 });
  const rows = [
    { id: "p1", negative: false, deterministic: { rank: 2 }, providers: { jev: completed(1) } },
    { id: "p2", negative: false, deterministic: { rank: 2 }, providers: { jev: completed(1) } },
    { id: "n1", negative: true, deterministic: { rank: null, negativeCorrect: true }, providers: { jev: { ...completed(null), negativeCorrect: false } } }
  ];
  const report = buildRerankEvalReport({ rows, providers: ["jev"] });
  assert.deepEqual(report.providers.jev.negatives, { count: 1, correct: 0, accuracy: 0 });
  assert.equal(report.providers.jev.promotion.deltas.top1, 1);
  assert.equal(report.providers.jev.promotion.eligible, false);
  // The negative returned no candidates, so it is also not evidence about the reranker.
  assert.deepEqual(report.providers.jev.promotion.reasons, ["hard-negative-regression", "no-negative-coverage"]);
  assert.deepEqual(report.providers.jev.negativeCoverage, { candidateCount: 0, completedCount: 0 });
});

test("rerank eval places none after candidates above it when Jev's explicit pick sits below none", async () => {
  const tmpRoot = new URL("./.test-tmp/eval-rerank-none-slot/", import.meta.url);
  await rm(tmpRoot, { force: true, recursive: true });
  await mkdir(tmpRoot, { recursive: true });
  const scenarioPath = new URL("scenarios.json", tmpRoot);
  await writeScenarios(scenarioPath, [
    { id: "pos", studio: "marketing", prompt: "write core offer launch copy", expectedSkill: "product-marketing" }
  ]);
  const jev = {
    impl: async ({ candidateCards }) => {
      const names = candidateCards.map((card) => card.name);
      const chosen = names.find((name) => name !== "product-marketing");
      const probability = (name) => (name === chosen ? 0.3 : name === "product-marketing" ? 0.5 : 0.1);
      const ordered = [chosen, ...names.filter((name) => name !== chosen).sort((a, b) => probability(b) - probability(a))];
      return {
        provider: "jev",
        mode: "shadow",
        status: "completed",
        model: "jev-fixture",
        inputCount: candidateCards.length,
        candidateCards,
        ranked: ordered.map((name, index) => ({ rank: index + 1, name, probability: probability(name) })),
        selectedSkillWouldChange: true,
        choice: chosen,
        abstained: false,
        noneProbability: 0.4
      };
    }
  };
  const report = buildRerankEvalReport(
    await runRerankQualityEval(scenarioPath, { catalogDir: fixtureCatalogDir, providers: { jev: jev.impl } })
  );
  // Order is [pick 0.3, product-marketing 0.5, none 0.4, ...]: product-marketing stays at rank 2.
  assert.equal(report.rows[0].providers.jev.shadow.rank, 2);
});

test("rerank eval CLI validates providers and candidate limits", async () => {
  assert.deepEqual(parseRerankEvalArgs(["--scenarios", "s.json", "--providers", "voyage,jev", "--candidate-limit", "10"]).providers, [
    "voyage",
    "jev"
  ]);
  assert.equal(parseRerankEvalArgs(["s.json", "--candidate-limit", "10"]).candidateLimit, 10);
  assert.equal(parseRerankEvalArgs(["--scenarios", "s.json"]).scenarioPath, "s.json");
  assert.throws(() => parseRerankEvalArgs(["s.json", "--providers", "voyage,cohere"]), /--providers/);
  assert.throws(() => parseRerankEvalArgs(["s.json", "--candidate-limit", "0"]), /--candidate-limit/);
  assert.throws(() => parseRerankEvalArgs(["s.json", "extra.json"]), /Unknown argument/);

  const output = execFileSync(
    process.execPath,
    ["src/eval-rerank.mjs", "--scenarios", "evals/rerank-quality/v1/scenarios.json", "--providers", "voyage,jev", "--candidate-limit", "10", "--summary"],
    { encoding: "utf8", env: { ...process.env, VOYAGE_API_KEY: "", TYPESAFE_API_KEY: "" } }
  );
  const summary = JSON.parse(output);
  assert.equal(summary.candidateLimit, 10);
  assert.deepEqual(Object.keys(summary.providers), ["voyage", "jev"]);
  assert.equal(summary.deterministicNegatives.count, 5);
});
