import assert from "node:assert/strict";
import test from "node:test";

import { buildCleanRoomInstallReportFromResults } from "../src/clean-room-install.mjs";

const routerSkills = [
  { name: "ceo-studio", path: "skills/ceo-studio/SKILL.md" },
  { name: "design-studio", path: "skills/design-studio/SKILL.md" },
  { name: "engineering-studio", path: "skills/engineering-studio/SKILL.md" },
  { name: "marketing-studio", path: "skills/marketing-studio/SKILL.md" }
];

const catalogSummaries = [
  {
    studio: "design",
    entryCount: 5,
    bodyFieldCount: 0,
    nonPortableSkillPathCount: 0
  },
  {
    studio: "marketing",
    entryCount: 8,
    bodyFieldCount: 0,
    nonPortableSkillPathCount: 0
  },
  {
    studio: "ceo",
    entryCount: 16,
    bodyFieldCount: 0,
    nonPortableSkillPathCount: 0
  },
  {
    studio: "engineering",
    entryCount: 75,
    bodyFieldCount: 0,
    nonPortableSkillPathCount: 0
  }
];

const passingScenarios = [
  {
    id: "design-hero",
    ok: true,
    summary: {
      resultCount: 3,
      topSkill: "baoyu-cover-image",
      readPaths: ["pack://jimliu%2Fbaoyu-skills/skills/baoyu-cover-image/SKILL.md"]
    }
  },
  {
    id: "marketing-hard-negative",
    ok: true,
    summary: {
      resultCount: 0,
      readPaths: []
    }
  }
];

test("clean-room install report passes for router-only visible skills and compact catalogs", () => {
  const report = buildCleanRoomInstallReportFromResults({
    packageSummary: {
      name: "agent-skill-debloater",
      version: "1.0.1",
      filename: "agent-skill-debloater-1.0.1.tgz"
    },
    pluginSummary: {
      skillsPath: "./skills/",
      defaultPromptCount: 2
    },
    visibleSkills: routerSkills,
    allSkillFiles: routerSkills.map((skill) => skill.path),
    catalogSummaries,
    scenarios: passingScenarios
  });

  assert.equal(report.ok, true);
  assert.equal(report.suite, "clean-room-install/v0");
  assert.deepEqual(
    report.visibleSkills.map((skill) => skill.name),
    ["ceo-studio", "design-studio", "engineering-studio", "marketing-studio"]
  );
  assert.equal(report.checks.find((item) => item.id === "visible-router-skills").ok, true);
  assert.equal(report.checks.find((item) => item.id === "backing-skill-bodies-hidden").ok, true);
  assert.match(report.proofBoundary, /does not prove customer VM/i);
});

test("clean-room install report fails when a backing skill body becomes prompt-visible", () => {
  const report = buildCleanRoomInstallReportFromResults({
    packageSummary: {
      name: "agent-skill-debloater",
      version: "1.0.1",
      filename: "agent-skill-debloater-1.0.1.tgz"
    },
    pluginSummary: {
      skillsPath: "./skills/",
      defaultPromptCount: 2
    },
    visibleSkills: routerSkills,
    allSkillFiles: [...routerSkills.map((skill) => skill.path), "skills/baoyu-cover-image/SKILL.md"],
    catalogSummaries,
    scenarios: passingScenarios
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.checks.find((item) => item.id === "backing-skill-bodies-hidden").detail.extraSkillFiles, [
    "skills/baoyu-cover-image/SKILL.md"
  ]);
});

test("clean-room install report rejects machine-local paths in shareable output", () => {
  const leakyPath = ["", "Volumes", "LEXAR", "repos", "agent-skill-debloater"].join("/");

  assert.throws(
    () =>
      buildCleanRoomInstallReportFromResults({
        packageSummary: {
          name: "agent-skill-debloater",
          version: "1.0.1",
          filename: "agent-skill-debloater-1.0.1.tgz"
        },
        pluginSummary: {
          skillsPath: "./skills/",
          defaultPromptCount: 2
        },
        visibleSkills: routerSkills,
        allSkillFiles: routerSkills.map((skill) => skill.path),
        catalogSummaries,
        scenarios: [
          {
            id: "leaky",
            ok: true,
            summary: {
              installedRoot: leakyPath
            }
          }
        ]
      }),
    /Machine-local path found/
  );
});
