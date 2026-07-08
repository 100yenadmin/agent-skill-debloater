import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

  const hero = report.rows.find((row) => row.id === "design-hero-cover");
  assert.equal(hero.selectedRouter, "design-studio");
  assert.match(hero.searchCommand, /debloat-skill-search design/);
  assert.equal(hero.top3Inspected, true);
  assert.equal(hero.selectedSkillTrace.name, "baoyu-cover-image");
  assert.equal(hero.selectedSkillTrace.readPath, "pack://jimliu%2Fbaoyu-skills/skills/baoyu-cover-image/SKILL.md");
  assert.equal(hero.sourceCapabilityDisclosure.source, "jimliu/baoyu-skills");
  assert.deepEqual(hero.sourceCapabilityDisclosure.capabilities, ["file-write"]);
  assert.equal(hero.wholePackLoaded, false);
  assert.equal("body" in hero.selectedSkillTrace, false);

  const ambiguity = report.rows.find((row) => row.id === "cross-studio-launch-hero-copy");
  assert.equal(ambiguity.kind, "ambiguity");
  assert.equal(ambiguity.alternateRouterResults[0].studio, "design");
  assert.equal(ambiguity.alternateRouterResults[0].topResults[0].name, "baoyu-cover-image");

  const negative = report.rows.find((row) => row.id === "hard-negative-general-trivia");
  assert.equal(negative.selectedRouter, null);
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
  assert.equal(report.metrics.hardNegativeFalsePositiveCount, 1);
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
