import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { findMachineLocalPaths } from "../src/portable-paths.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const ignoredDirs = new Set([".git", "node_modules", ".test-tmp"]);

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

test("public artifacts do not ship machine-local absolute paths", async () => {
  const files = await listFiles(repoRoot);

  for (const file of files) {
    const body = await readFile(file, "utf8");
    assert.deepEqual(findMachineLocalPaths(body), [], file);
  }
});

test("machine-local path detector catches common user-home formats", () => {
  const spacedVolume = "/" + "Volumes/" + "My Drive/repos/example";
  const body = [
    "/" + "Users/alice/.codex/skills/foo/SKILL.md",
    "/" + "home/bob/.agents/skills/bar/SKILL.md",
    "/" + "Volumes/LEXAR/repos/example",
    spacedVolume,
    "/" + "workspaces/agent-skill-debloater/skills/foo/SKILL.md",
    "/" + "tmp/agent-skill-debloater/skills/foo/SKILL.md",
    "C:" + String.raw`\Users\Casey\skills\baz\SKILL.md`
  ].join("\n");

  assert.equal(findMachineLocalPaths(body).length, 7);
  assert.ok(findMachineLocalPaths(body).some((match) => match.value === spacedVolume));
});
