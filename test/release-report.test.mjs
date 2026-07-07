import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { buildReleaseChecklist, buildReleaseNotes } from "../src/release-report.mjs";

test("release checklist captures v1.0 package, plugin, validation, package contents, and no-publish boundary", async () => {
  const checklist = await buildReleaseChecklist();

  assert.equal(checklist.package.name, "agent-skill-debloater");
  assert.equal(checklist.package.version, "1.0.1");
  assert.ok(checklist.package.files.includes(".codex-plugin/"));
  assert.ok(checklist.package.files.includes("evals/skill-routing-evals/v0/scenarios.json"));
  assert.deepEqual(checklist.packageContents.missing, []);
  assert.deepEqual(checklist.packageContents.forbiddenPresent, []);
  assert.ok(checklist.pluginManifest.present);
  assert.equal(checklist.pluginManifest.name, "agent-skill-debloater");
  assert.equal(checklist.pluginManifest.version, "1.0.1");
  assert.deepEqual(checklist.requiredScripts.missing, []);
  assert.deepEqual(checklist.publishSurfaces, []);
  assert.ok(checklist.validationCommands.includes("npm test"));
  assert.ok(checklist.validationCommands.includes("npm run eval:routing"));
  assert.ok(checklist.validationCommands.includes("node bin/pack-sync check"));
});

test("release notes describe plugin scope, proof boundary, and no npm publish", async () => {
  const notes = await buildReleaseNotes();

  assert.match(notes, /^# AgentSkillDebloater v1\.0\.1/m);
  assert.match(notes, /OpenClaw adapter/i);
  assert.match(notes, /pack-sync diff\/update/i);
  assert.match(notes, /No npm publish/i);
  assert.match(notes, /does not prove customer VM rollout/i);
});

test("release-report CLI check prints stable JSON", () => {
  const output = execFileSync(process.execPath, ["src/release-report.mjs", "check"], {
    encoding: "utf8"
  });
  const checklist = JSON.parse(output);

  assert.equal(checklist.ok, true);
  assert.equal(checklist.package.version, "1.0.1");
});

test("release checklist rejects publish command variants in scripts and workflows", async () => {
  const fakeRoot = {
    "package.json": {
      name: "agent-skill-debloater",
      version: "1.0.0",
      files: [".codex-plugin/"],
      scripts: {
        test: "node --test test/*.test.mjs",
        "eval:routing": "node src/eval-routing.mjs evals/skill-routing-evals/v0/scenarios.json --summary",
        "release:check": "node src/release-report.mjs check",
        "release:notes": "node src/release-report.mjs notes",
        "pack:dry-run": "npm pack --dry-run --json",
        "smoke:openclaw-adapter": "node bin/agent-skill-debloater openclaw-adapter search design \"launch hero cover image\"",
        publishish: "npm --tag latest publish"
      }
    },
    ".codex-plugin/plugin.json": {
      name: "agent-skill-debloater",
      version: "1.0.0",
      skills: "./skills/"
    },
    ".github/workflows/release.yml": "steps:\n  - uses: npm/action-publish@v1\n  - run: pnpm publish\n",
    "__packDryRun.json": [
      {
        files: [
          { path: ".codex-plugin/plugin.json" },
          { path: "bin/agent-skill-debloater" },
          { path: "bin/debloat-skill-search" },
          { path: "bin/pack-sync" },
          { path: "catalogs/design.json" },
          { path: "catalogs/marketing.json" },
          { path: "catalogs/ceo.json" },
          { path: "catalogs/engineering.json" },
          { path: "docs/openclaw-adapter.md" },
          { path: "locks/baoyu-skills.lock.json" },
          { path: "overlays/studios.json" },
          { path: "packs/baoyu-skills.json" },
          { path: "schemas/catalog.schema.json" },
          { path: "skills/design-studio/SKILL.md" },
          { path: "skills/marketing-studio/SKILL.md" },
          { path: "skills/ceo-studio/SKILL.md" },
          { path: "skills/engineering-studio/SKILL.md" },
          { path: "src/cli.mjs" },
          { path: "src/openclaw-adapter.mjs" },
          { path: "src/pack-sync.mjs" },
          { path: "src/release-report.mjs" },
          { path: "src/search.mjs" }
        ]
      }
    ]
  };
  const checklist = await buildReleaseChecklist({
    readText: async (relativePath) => {
      const value = fakeRoot[relativePath];
      if (value === undefined) throw new Error(`missing ${relativePath}`);
      return typeof value === "string" ? value : JSON.stringify(value);
    },
    exists: async (relativePath) => fakeRoot[relativePath] !== undefined,
    listWorkflowFiles: async () => [".github/workflows/release.yml"],
    runPackDryRun: async () => fakeRoot["__packDryRun.json"]
  });

  assert.equal(checklist.ok, false);
  assert.ok(checklist.publishSurfaces.some((surface) => surface.includes("package script publishish")));
  assert.ok(checklist.publishSurfaces.some((surface) => surface.includes("workflow .github/workflows/release.yml")));
});

test("release checklist ships eval scenarios but rejects generated eval reports across suite versions", async () => {
  const fakeRoot = {
    "package.json": {
      name: "agent-skill-debloater",
      version: "1.0.0",
      files: [".codex-plugin/", "evals/skill-routing-evals/v0/scenarios.json"],
      scripts: {
        test: "node --test test/*.test.mjs",
        "eval:routing": "node src/eval-routing.mjs evals/skill-routing-evals/v0/scenarios.json --summary",
        "release:check": "node src/release-report.mjs check",
        "release:notes": "node src/release-report.mjs notes",
        "pack:dry-run": "npm pack --dry-run --json",
        "smoke:openclaw-adapter": "node bin/agent-skill-debloater openclaw-adapter search design \"launch hero cover image\""
      }
    },
    ".codex-plugin/plugin.json": {
      name: "agent-skill-debloater",
      version: "1.0.0",
      skills: "./skills/"
    },
    "__packDryRun.json": [
      {
        files: [
          { path: ".codex-plugin/plugin.json" },
          { path: "bin/agent-skill-debloater" },
          { path: "bin/debloat-skill-search" },
          { path: "bin/pack-sync" },
          { path: "catalogs/design.json" },
          { path: "catalogs/marketing.json" },
          { path: "catalogs/ceo.json" },
          { path: "catalogs/engineering.json" },
          { path: "evals/skill-routing-evals/v0/scenarios.json" },
          { path: "docs/openclaw-adapter.md" },
          { path: "locks/baoyu-skills.lock.json" },
          { path: "overlays/studios.json" },
          { path: "packs/baoyu-skills.json" },
          { path: "schemas/catalog.schema.json" },
          { path: "skills/design-studio/SKILL.md" },
          { path: "skills/marketing-studio/SKILL.md" },
          { path: "skills/ceo-studio/SKILL.md" },
          { path: "skills/engineering-studio/SKILL.md" },
          { path: "src/cli.mjs" },
          { path: "src/openclaw-adapter.mjs" },
          { path: "src/pack-sync.mjs" },
          { path: "src/release-report.mjs" },
          { path: "src/search.mjs" },
          { path: "evals/skill-routing-evals/v0/routing-report.json" },
          { path: "evals/skill-routing-evals/v2/routing-report.json" }
        ]
      }
    ]
  };
  const checklist = await buildReleaseChecklist({
    readText: async (relativePath) => {
      const value = fakeRoot[relativePath];
      if (value === undefined) throw new Error(`missing ${relativePath}`);
      return typeof value === "string" ? value : JSON.stringify(value);
    },
    exists: async (relativePath) => fakeRoot[relativePath] !== undefined,
    listWorkflowFiles: async () => [],
    runPackDryRun: async () => fakeRoot["__packDryRun.json"]
  });

  assert.equal(checklist.ok, false);
  assert.deepEqual(checklist.packageContents.forbiddenPresent, [
    "evals/skill-routing-evals/v0/routing-report.json",
    "evals/skill-routing-evals/v2/routing-report.json"
  ]);
});

test("release-report CLI notes prints markdown", () => {
  const output = execFileSync(process.execPath, ["src/release-report.mjs", "notes"], {
    encoding: "utf8"
  });

  assert.match(output, /^# AgentSkillDebloater v1\.0\.1/m);
});
