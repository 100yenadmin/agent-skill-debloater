import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  searchOpenClawSkillCatalog,
  toOpenClawAdapterResponse,
  toSelectedSkillTrace
} from "../src/openclaw-adapter.mjs";

const fixtureDir = new URL("./fixtures/catalogs/", import.meta.url);
const pluginValidator =
  process.env.CODEX_PLUGIN_VALIDATOR ??
  path.join(os.homedir(), ".codex", "skills", ".system", "plugin-creator", "scripts", "validate_plugin.py");

test("OpenClaw adapter returns compact candidates with a selected-skill audit trace", async () => {
  const response = await searchOpenClawSkillCatalog({
    studio: "design",
    query: "create a launch hero cover image",
    catalogDir: fixtureDir
  });

  assert.equal(response.adapter, "agent-skill-debloater/openclaw-adapter/v1");
  assert.deepEqual(response.request, {
    studio: "design",
    query: "create a launch hero cover image",
    limit: 3,
    engine: "fts"
  });
  assert.equal(response.candidates[0].name, "baoyu-cover-image");
  assert.equal(
    response.candidates[0].readPath,
    "pack://jimliu%2Fbaoyu-skills/skills/baoyu-cover-image/SKILL.md"
  );
  assert.equal(response.candidates[0].body, undefined);
  assert.equal(response.selectedSkillTrace.name, "baoyu-cover-image");
  assert.equal(response.selectedSkillTrace.rank, 1);
  assert.equal(response.selectedSkillTrace.readPath, response.candidates[0].readPath);
  assert.deepEqual(response.selectedSkillTrace.capabilities, ["file-write"]);
});

test("OpenClaw adapter reports no selected trace when search finds no clear match", async () => {
  const response = await searchOpenClawSkillCatalog({
    studio: "marketing",
    query: "repair a kubernetes storage class bug",
    catalogDir: fixtureDir
  });

  assert.deepEqual(response.candidates, []);
  assert.equal(response.selectedSkillTrace, null);
});

test("OpenClaw adapter does not auto-select ambiguous top candidates", async () => {
  const response = await searchOpenClawSkillCatalog({
    studio: "design",
    query: "diagram slide",
    catalogDir: fixtureDir,
    limit: 1
  });

  assert.equal(response.candidates.length, 1);
  assert.equal(response.candidates[0].confidenceLabel, "ambiguous");
  assert.equal(response.selectedSkillTrace, null);
});

test("OpenClaw selected-skill trace keeps audit fields but omits candidate prose", () => {
  const trace = toSelectedSkillTrace(
    {
      name: "example",
      title: "Example",
      studio: "design",
      source: "example/pack",
      pack: "example/pack",
      description: "Prose that belongs in candidates, not audit traces.",
      useWhen: "Use when an agent needs an example.",
      capabilities: ["read-only"],
      sourceCommit: "0000000000000000000000000000000000000000",
      sourceUrl: "https://github.com/example/pack/blob/0000000000000000000000000000000000000000/skills/example/SKILL.md",
      skillPath: "skills/example/SKILL.md",
      readPath: "pack://example%2Fpack/skills/example/SKILL.md",
      confidence: 0.9,
      confidenceLabel: "high",
      score: 72,
      why: ["exact:example"]
    },
    { rank: 2 }
  );

  assert.equal(trace.name, "example");
  assert.equal(trace.rank, 2);
  assert.equal(trace.description, undefined);
  assert.equal(trace.useWhen, undefined);
});

test("OpenClaw adapter response preserves explicit candidates and trace", () => {
  const response = toOpenClawAdapterResponse({
    studio: "engineering",
    query: "debug the issue",
    limit: 1,
    engine: "json",
    results: [
      {
        name: "diagnosing-bugs",
        title: "Diagnosing Bugs",
        studio: "engineering",
        source: "obra/superpowers",
        pack: "obra/superpowers",
        description: "Use for debugging.",
        useWhen: "Use when debugging.",
        capabilities: ["read-only"],
        sourceCommit: "0000000000000000000000000000000000000000",
        sourceUrl: "https://github.com/obra/superpowers/blob/0000000000000000000000000000000000000000/skills/diagnosing-bugs/SKILL.md",
        skillPath: "skills/diagnosing-bugs/SKILL.md",
        readPath: "pack://obra%2Fsuperpowers/skills/diagnosing-bugs/SKILL.md",
        confidence: 0.92,
        confidenceLabel: "high",
        score: 88,
        why: ["aliases:debug"]
      }
    ]
  });

  assert.equal(response.request.engine, "json");
  assert.equal(response.selectedSkillTrace.name, "diagnosing-bugs");
  assert.equal(response.candidates.length, 1);
});

test("agent-skill-debloater exposes the OpenClaw adapter search command", () => {
  const output = execFileSync(
    process.execPath,
    [
      "bin/agent-skill-debloater",
      "openclaw-adapter",
      "search",
      "design",
      "launch hero cover image",
      "--catalog-dir",
      fileURLToPath(fixtureDir)
    ],
    { encoding: "utf8" }
  );
  const response = JSON.parse(output);

  assert.equal(response.adapter, "agent-skill-debloater/openclaw-adapter/v1");
  assert.equal(response.selectedSkillTrace.name, "baoyu-cover-image");
});

test("OpenClaw adapter CLI resolves read paths from AGENT_SKILL_DEBLOATER_PACK_ROOTS", () => {
  const output = execFileSync(
    process.execPath,
    [
      "bin/agent-skill-debloater",
      "openclaw-adapter",
      "search",
      "design",
      "launch hero cover image",
      "--catalog-dir",
      fileURLToPath(fixtureDir)
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_SKILL_DEBLOATER_PACK_ROOTS: JSON.stringify({
          "jimliu/baoyu-skills": "/env/packs/baoyu-skills"
        })
      }
    }
  );
  const response = JSON.parse(output);

  assert.equal(
    response.candidates[0].readPath,
    "/env/packs/baoyu-skills/skills/baoyu-cover-image/SKILL.md"
  );
  assert.equal(response.selectedSkillTrace.readPath, response.candidates[0].readPath);
});

test("Codex plugin manifest exposes router skills and keeps runtime policy in the package", async () => {
  const manifest = JSON.parse(await readFile(new URL("../.codex-plugin/plugin.json", import.meta.url), "utf8"));

  assert.equal(manifest.name, "agent-skill-debloater");
  assert.equal(manifest.version, "1.0.1");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.repository, "https://github.com/100yenadmin/agent-skill-debloater");
  assert.equal(manifest.interface.displayName, "AgentSkillDebloater");
  assert.ok(manifest.keywords.includes("skill-search"));
  assert.ok(manifest.keywords.includes("openclaw"));
});

test(
  "Codex plugin manifest validates with local plugin validator",
  { skip: existsSync(pluginValidator) ? false : "CODEX_PLUGIN_VALIDATOR is not available" },
  () => {
  execFileSync(
    "python3",
    [
      pluginValidator,
      fileURLToPath(new URL("../", import.meta.url))
    ],
    { encoding: "utf8" }
  );
  }
);
