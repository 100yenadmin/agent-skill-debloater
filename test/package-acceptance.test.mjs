import assert from "node:assert/strict";
import test from "node:test";

import { buildPackageAcceptanceReportFromResults } from "../src/package-acceptance.mjs";

const requiredFiles = [
  ".codex-plugin/plugin.json",
  "bin/agent-skill-debloater",
  "bin/debloat-skill-search",
  "catalogs/design.json",
  "catalogs/marketing.json",
  "catalogs/ceo.json",
  "catalogs/engineering.json",
  "docs/future-studios.md",
  "docs/customer-canary-plan.md",
  "docs/demo-router-flow.md",
  "docs/launch-packet.md",
  "docs/npm-publication-gate.md",
  "docs/pack-update-cadence.md",
  "docs/rerank-quality.md",
  "evals/fresh-agent-smokes/v0/scenarios.json",
  "evals/rerank-quality/v0/scenarios.json",
  "skills/design-studio/SKILL.md",
  "skills/marketing-studio/SKILL.md",
  "skills/ceo-studio/SKILL.md",
  "skills/engineering-studio/SKILL.md",
  "src/clean-room-install.mjs",
  "src/cli.mjs",
  "src/eval-rerank.mjs",
  "src/fresh-agent-smoke.mjs",
  "src/openclaw-adapter.mjs",
  "src/pack-update-cadence.mjs",
  "src/search.mjs"
];

function packEntry({ files = requiredFiles } = {}) {
  return {
    name: "agent-skill-debloater",
    version: "1.0.2",
    filename: "agent-skill-debloater-1.0.2.tgz",
    size: 75406,
    unpackedSize: 351857,
    shasum: "48fb9795bb1342657bc57a559ba235f933cbcec5",
    integrity: "sha512-example",
    entryCount: files.length,
    files: files.map((path) => ({ path }))
  };
}

function passingScenarios() {
  return [
    {
      id: "adapter-design-hero",
      ok: true,
      command: "node package/bin/agent-skill-debloater openclaw-adapter search design ...",
      summary: {
        selectedSkill: "baoyu-cover-image",
        selectedReadPath: "pack://jimliu%2Fbaoyu-skills/skills/baoyu-cover-image/SKILL.md"
      }
    },
    {
      id: "search-marketing-hard-negative",
      ok: true,
      command: "node package/bin/debloat-skill-search marketing ...",
      summary: {
        resultCount: 0
      }
    }
  ];
}

test("package acceptance report passes with required files and successful scenarios", () => {
  const report = buildPackageAcceptanceReportFromResults({
    packEntry: packEntry(),
    scenarios: passingScenarios()
  });

  assert.equal(report.ok, true);
  assert.equal(report.suite, "package-acceptance/v0");
  assert.equal(report.package.name, "agent-skill-debloater");
  assert.equal(report.package.filename, "agent-skill-debloater-1.0.2.tgz");
  assert.equal(report.checks.find((item) => item.id === "required-files").ok, true);
  assert.equal(report.checks.find((item) => item.id === "scenario-results").ok, true);
  assert.match(report.proofBoundary, /does not prove customer VM rollout/i);
});

test("package acceptance report fails when required package files are missing", () => {
  const report = buildPackageAcceptanceReportFromResults({
    packEntry: packEntry({
      files: requiredFiles.filter((file) => file !== "src/openclaw-adapter.mjs")
    }),
    scenarios: passingScenarios()
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.checks.find((item) => item.id === "required-files").detail.missing, [
    "src/openclaw-adapter.mjs"
  ]);
});

test("package acceptance report rejects generated reports and test files in the package", () => {
  const report = buildPackageAcceptanceReportFromResults({
    packEntry: packEntry({
      files: [
        ...requiredFiles,
        "evals/skill-routing-evals/v0/routing-report.json",
        "evals/rerank-quality/v0/rerank-report.json",
        "test/search.test.mjs"
      ]
    }),
    scenarios: passingScenarios()
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.checks.find((item) => item.id === "forbidden-files").detail.forbiddenPresent, [
    "evals/rerank-quality/v0/rerank-report.json",
    "evals/skill-routing-evals/v0/routing-report.json",
    "test/search.test.mjs"
  ]);
});

test("package acceptance report fails when any packaged smoke scenario fails", () => {
  const report = buildPackageAcceptanceReportFromResults({
    packEntry: packEntry(),
    scenarios: [
      ...passingScenarios(),
      {
        id: "adapter-engineering-tdd",
        ok: false,
        command: "node package/bin/agent-skill-debloater openclaw-adapter search engineering ...",
        summary: {
          selectedSkill: "plan-eng-review"
        }
      }
    ]
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.checks.find((item) => item.id === "scenario-results").detail.failed, [
    "adapter-engineering-tdd"
  ]);
});

test("package acceptance report rejects machine-local paths in shareable output", () => {
  const leakyPath = ["", "Volumes", "LEXAR", "repos", "agent-skill-debloater", "bin", "agent-skill-debloater"].join("/");

  assert.throws(
    () =>
      buildPackageAcceptanceReportFromResults({
        packEntry: packEntry(),
        scenarios: [
          {
            id: "leaky",
            ok: true,
            command: `node ${leakyPath}`,
            summary: {}
          }
        ]
      }),
    /Machine-local path found/
  );
});
