import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  buildCleanRoomInstallReport,
  buildCleanRoomInstallReportFromResults
} from "../src/clean-room-install.mjs";

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

async function writeFakeInstalledPlugin(tmpDir, searchResponse) {
  const installedRoot = path.join(tmpDir, "fake-installed-plugin");
  await mkdir(path.join(installedRoot, ".codex-plugin"), { recursive: true });
  await mkdir(path.join(installedRoot, "bin"), { recursive: true });
  await mkdir(path.join(installedRoot, "catalogs"), { recursive: true });

  await writeFile(
    path.join(installedRoot, ".codex-plugin", "plugin.json"),
    JSON.stringify({ skills: "./skills/", interface: { defaultPrompt: ["Search"] } })
  );

  for (const skill of routerSkills) {
    const fullPath = path.join(installedRoot, skill.path);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, `---\nname: ${skill.name}\n---\n# ${skill.name}\n`);
  }

  for (const catalog of catalogSummaries) {
    await writeFile(
      path.join(installedRoot, "catalogs", `${catalog.studio}.json`),
      JSON.stringify([
        {
          name: "fixture",
          skillPath: "skills/fixture/SKILL.md"
        }
      ])
    );
  }

  await writeFile(
    path.join(installedRoot, "bin", "debloat-skill-search"),
    `console.log(${JSON.stringify(JSON.stringify(searchResponse))});\n`
  );

  return installedRoot;
}

test("clean-room install report passes for router-only visible skills and compact catalogs", () => {
  const report = buildCleanRoomInstallReportFromResults({
    packageSummary: {
      name: "agent-skill-debloater",
      version: "1.0.2-rc.2",
      filename: "agent-skill-debloater-1.0.2-rc.2.tgz"
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
      version: "1.0.2-rc.2",
      filename: "agent-skill-debloater-1.0.2-rc.2.tgz"
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
          version: "1.0.2-rc.2",
          filename: "agent-skill-debloater-1.0.2-rc.2.tgz"
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

test("clean-room install rejects malformed pack read paths and leaked candidate bodies", async () => {
  const report = await buildCleanRoomInstallReport({
    packPackage: async () => ({
      packEntry: {
        name: "agent-skill-debloater",
        version: "1.0.2-rc.2",
        filename: "agent-skill-debloater-1.0.2-rc.2.tgz",
        files: []
      },
      tarballPath: "unused.tgz"
    }),
    extractPackage: async () => "unused-package-root",
    installPackage: async (_packageRoot, tmpDir) =>
      writeFakeInstalledPlugin(tmpDir, {
        results: [
          {
            name: "baoyu-cover-image",
            readPath: "pack://",
            content: "# Full backing skill body"
          }
        ]
      }),
    scenarios: [
      {
        id: "leaky-result",
        studio: "design",
        query: "launch hero cover image",
        expectedTopSkill: "baoyu-cover-image"
      }
    ]
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.checks.find((item) => item.id === "installed-cli-scenarios").detail.failed, [
    "leaky-result"
  ]);
  assert.equal(report.scenarios[0].summary.hasBodyLeaks, true);
  assert.deepEqual(report.scenarios[0].summary.invalidReadPaths, ["pack://"]);
});
