import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import {
  buildFreshAgentSmokeReport,
  runFreshAgentSmokes
} from "../src/fresh-agent-smoke.mjs";

const scenarioPath = new URL("../evals/fresh-agent-smokes/v0/scenarios.json", import.meta.url);

test("committed fresh-agent smoke suite proves router/search/read-path behavior", async () => {
  const result = await runFreshAgentSmokes(scenarioPath);
  const report = buildFreshAgentSmokeReport(result);

  assert.equal(report.ok, true);
  assert.equal(report.suite, "fresh-agent-smokes/v0");
  assert.equal(report.scenarioCount, 9);
  assert.equal(report.metrics.passRate, 1);
  assert.equal(report.metrics.hardNegativeFalsePositiveCount, 0);
  assert.deepEqual(report.requiredCoverage.missingKinds, []);
  assert.deepEqual(report.requiredCoverage.missingPositiveStudios, []);

  const hero = report.rows.find((row) => row.id === "design-hero-cover");
  assert.equal(hero.selectedRouter, "design-studio");
  assert.equal(hero.routerDecision.disposition, "select");
  assert.equal(hero.routerDecision.selectedRouter, "design-studio");
  assert.match(hero.searchCommand, /debloat-skill-search design/);
  assert.match(hero.searchCommand, /--engine fts/);
  assert.match(hero.searchCommand, /Create a polished launch hero cover image/);
  assert.equal(hero.top3Inspected, true);
  assert.equal(hero.selectedSkillTrace.name, "baoyu-cover-image");
  assert.equal(hero.selectedSkillTrace.readPath, "pack://jimliu%2Fbaoyu-skills/skills/baoyu-cover-image/SKILL.md");
  assert.equal(hero.sourceCapabilityDisclosure.source, "jimliu/baoyu-skills");
  assert.deepEqual(hero.sourceCapabilityDisclosure.capabilities, ["file-write"]);
  assert.equal(hero.wholePackLoaded, false);
  assert.equal("body" in hero.selectedSkillTrace, false);

  const ambiguity = report.rows.find((row) => row.id === "cross-studio-launch-hero-copy");
  assert.equal(ambiguity.kind, "ambiguity");
  assert.equal(ambiguity.routerDecision.disposition, "clarify");
  assert.equal(ambiguity.selectedSkillTrace, null);
  assert.equal(ambiguity.alternateRouterResults[0].studio, "design");
  assert.equal(ambiguity.alternateRouterResults[0].topResults[0].name, "baoyu-cover-image");

  const negative = report.rows.find((row) => row.id === "hard-negative-general-trivia");
  assert.equal(negative.selectedRouter, null);
  assert.equal(negative.routerDecision.disposition, "abstain");
  assert.deepEqual(negative.falsePositiveStudios, []);
});

test("fresh-agent smoke report fails missing required coverage and hard-negative false positives", () => {
  const report = buildFreshAgentSmokeReport({
    suite: "fresh-agent-smokes/v0",
    rows: [
      {
        id: "bad-negative",
        kind: "hard-negative",
        ok: false,
        prompt: "What is the capital of France?",
        selectedRouter: "marketing-studio",
        falsePositiveStudios: ["marketing"],
        failures: ["hard-negative-false-positive"]
      }
    ]
  });

  assert.equal(report.ok, false);
  assert.ok(report.requiredCoverage.missingKinds.includes("positive"));
  assert.deepEqual(report.requiredCoverage.missingPositiveStudios, ["ceo", "design", "engineering", "marketing"]);
  assert.equal(report.metrics.hardNegativeFalsePositiveCount, 1);
});

test("fresh-agent smoke fails when positive studio coverage is incomplete despite required kinds", () => {
  const report = buildFreshAgentSmokeReport({
    suite: "fresh-agent-smokes/v0",
    rows: [
      {
        id: "design-positive",
        kind: "positive",
        ok: true,
        selectedStudio: "design",
        failures: []
      },
      {
        id: "ambiguous",
        kind: "ambiguity",
        ok: true,
        selectedStudio: null,
        failures: []
      },
      {
        id: "negative",
        kind: "hard-negative",
        ok: true,
        falsePositiveStudios: [],
        failures: []
      }
    ]
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.requiredCoverage.missingKinds, []);
  assert.deepEqual(report.requiredCoverage.missingPositiveStudios, ["ceo", "engineering", "marketing"]);
  assert.ok(report.thresholdFailures.includes("missing-positive-studios"));
});

test("fresh-agent smoke derives router selection from prompt, not scenario studio", async () => {
  const tmpRoot = new URL("./.test-tmp/fresh-agent-smoke-router-selection/", import.meta.url);
  await rm(tmpRoot, { recursive: true, force: true });
  await mkdir(tmpRoot, { recursive: true });
  const badPromptPath = new URL("scenarios.json", tmpRoot);
  await writeFile(
    badPromptPath,
    JSON.stringify([
      {
        id: "bad-router",
        kind: "positive",
        prompt: "What is the capital of France?",
        studio: "design",
        query: "hero cover image",
        expectedRouter: "design-studio",
        expectedSkill: "baoyu-cover-image",
        expectedReadPath: "pack://jimliu%2Fbaoyu-skills/skills/baoyu-cover-image/SKILL.md",
        expectedCapabilities: ["file-write"],
        expectedDisposition: "select"
      }
    ])
  );

  const report = buildFreshAgentSmokeReport(await runFreshAgentSmokes(badPromptPath));
  const row = report.rows[0];

  assert.equal(report.ok, false);
  assert.equal(row.routerDecision.disposition, "abstain");
  assert.ok(row.failures.includes("router-selection"));
});

test("fresh-agent smoke detects raw body fields before compacting results", async () => {
  const tmpRoot = new URL("./.test-tmp/fresh-agent-smoke-body-leak/", import.meta.url);
  await rm(tmpRoot, { recursive: true, force: true });
  await mkdir(tmpRoot, { recursive: true });
  const leakPath = new URL("scenarios.json", tmpRoot);
  await writeFile(
    leakPath,
    JSON.stringify([
      {
        id: "raw-body-leak",
        kind: "positive",
        prompt: "Create a polished launch hero cover image.",
        studio: "design",
        query: "hero cover image",
        expectedRouter: "design-studio",
        expectedSkill: "baoyu-cover-image",
        expectedReadPath: "pack://jimliu%2Fbaoyu-skills/skills/baoyu-cover-image/SKILL.md",
        expectedCapabilities: ["file-write"],
        expectedDisposition: "select"
      }
    ])
  );
  const leakingResult = {
    name: "baoyu-cover-image",
    title: "Baoyu Cover Image",
    studio: "design",
    source: "jimliu/baoyu-skills",
    pack: "jimliu/baoyu-skills",
    capabilities: ["file-write"],
    skillPath: "skills/baoyu-cover-image/SKILL.md",
    readPath: "pack://jimliu%2Fbaoyu-skills/skills/baoyu-cover-image/SKILL.md",
    confidence: 0.98,
    confidenceLabel: "high",
    score: 100,
    why: ["fixture"],
    body: "hidden backing instructions must not be emitted"
  };

  const report = buildFreshAgentSmokeReport(
    await runFreshAgentSmokes(leakPath, {
      searchImpl: async ({ studio }) => (studio === "design" ? [leakingResult] : [])
    })
  );
  const row = report.rows[0];

  assert.equal(report.ok, false);
  assert.equal(row.wholePackLoaded, true);
  assert.deepEqual(row.bodyLeakFields, ["$[0].body"]);
  assert.ok(row.failures.includes("body-field-leak"));
});

test("fresh-agent smoke CLI writes a JSON report and prints summary", async () => {
  const tmpRoot = new URL("./.test-tmp/fresh-agent-smoke-cli/", import.meta.url);
  await rm(tmpRoot, { recursive: true, force: true });
  await mkdir(tmpRoot, { recursive: true });
  const reportPath = new URL("report.json", tmpRoot);

  const output = execFileSync(
    process.execPath,
    [
      "src/fresh-agent-smoke.mjs",
      "evals/fresh-agent-smokes/v0/scenarios.json",
      "--summary",
      "--report",
      reportPath.pathname
    ],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8"
    }
  );
  const report = JSON.parse(await readFile(reportPath, "utf8"));

  assert.match(output, /fresh-agent-smokes\/v0/);
  assert.match(output, /passRate=1/);
  assert.equal(report.ok, true);
});

test("fresh-agent smoke CLI reports missing --report values as usage errors", () => {
  const result = spawnSync(
    process.execPath,
    ["src/fresh-agent-smoke.mjs", "evals/fresh-agent-smokes/v0/scenarios.json", "--report"],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--report requires a value/);
  assert.match(result.stderr, /Usage:/);
});

test("fresh-agent smoke rejects duplicate scenario ids", async () => {
  const tmpRoot = new URL("./.test-tmp/fresh-agent-smoke-duplicates/", import.meta.url);
  await rm(tmpRoot, { recursive: true, force: true });
  await mkdir(tmpRoot, { recursive: true });
  const duplicatePath = new URL("scenarios.json", tmpRoot);
  await writeFile(
    duplicatePath,
    JSON.stringify([
      {
        id: "duplicate",
        kind: "positive",
        prompt: "Hero image",
        studio: "design",
        query: "hero image",
        expectedRouter: "design-studio",
        expectedSkill: "baoyu-cover-image",
        expectedReadPath: "pack://jimliu%2Fbaoyu-skills/skills/baoyu-cover-image/SKILL.md",
        expectedCapabilities: ["file-write"]
      },
      {
        id: "duplicate",
        kind: "hard-negative",
        prompt: "What time is it?",
        expectedSelectedStudio: null,
        studios: ["design"]
      }
    ])
  );

  await assert.rejects(runFreshAgentSmokes(duplicatePath), /id must be unique/);
});
