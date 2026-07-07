import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  loadJsonSchema,
  schemaNameForDirectory,
  validateArtifactSchema,
  validateJsonWithSchema
} from "../src/schema-validation.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const artifactDirs = ["packs", "locks", "overlays", "catalogs"];

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

test("public schemas validate committed pack, lock, overlay, and catalog artifacts", async () => {
  for (const dir of artifactDirs) {
    const absoluteDir = path.join(repoRoot, dir);
    const files = (await readdir(absoluteDir)).filter((file) => file.endsWith(".json")).sort();

    for (const file of files) {
      const artifactPath = path.join(absoluteDir, file);
      await validateArtifactSchema(await readJson(artifactPath), dir, {
        label: path.relative(repoRoot, artifactPath)
      });
    }
  }
});

test("schema registry maps every checked artifact directory to a public schema", () => {
  assert.deepEqual(
    artifactDirs.map((dir) => [dir, schemaNameForDirectory(dir)]),
    [
      ["packs", "pack.schema.json"],
      ["locks", "lock.schema.json"],
      ["overlays", "overlay.schema.json"],
      ["catalogs", "catalog.schema.json"]
    ]
  );
});

test("catalog schema rejects unknown capability labels", async () => {
  const schema = await loadJsonSchema("catalog.schema.json");
  const entry = {
    name: "bad-capability",
    title: "Bad Capability",
    studio: "marketing",
    source: "example/pack",
    pack: "example/pack",
    skillPath: "skills/bad-capability/SKILL.md",
    description: "Fixture with an invalid capability.",
    aliases: [],
    tags: [],
    capabilities: ["shell-root"],
    sourceCommit: "0000000000000000000000000000000000000000",
    sourceUrl: "https://github.com/example/pack/blob/0000000000000000000000000000000000000000/skills/bad-capability/SKILL.md"
  };

  assert.throws(
    () => validateJsonWithSchema([entry], schema, { label: "catalogs/fixture.json" }),
    /capabilities.*must be one of/
  );
});

test("catalog schema rejects non-portable skill paths", async () => {
  const schema = await loadJsonSchema("catalog.schema.json");
  const baseEntry = {
    name: "bad-path",
    title: "Bad Path",
    studio: "marketing",
    source: "example/pack",
    pack: "example/pack",
    skillPath: "skills/bad-path/SKILL.md",
    description: "Fixture with a bad path.",
    aliases: [],
    tags: [],
    capabilities: ["read-only"],
    sourceCommit: "0000000000000000000000000000000000000000",
    sourceUrl: "https://github.com/example/pack/blob/0000000000000000000000000000000000000000/skills/bad-path/SKILL.md"
  };

  for (const skillPath of [
    "skills/../escape/SKILL.md",
    "/" + "Users/alice/skills/bad-path/SKILL.md",
    "C:" + String.raw`\Users\alice\skills\bad-path\SKILL.md`,
    "file" + ":skills/bad-path/SKILL.md"
  ]) {
    assert.throws(
      () => validateJsonWithSchema([{ ...baseEntry, skillPath }], schema, { label: "catalogs/fixture.json" }),
      /skillPath.*must match/
    );
  }
});

test("pack schema rejects non-portable allowed path patterns", async () => {
  const schema = await loadJsonSchema("pack.schema.json");
  const basePack = {
    id: "example/pack",
    repoUrl: "https://github.com/example/pack",
    allowedPaths: ["skills/**/SKILL.md"],
    pinPolicy: "sha",
    licensePolicy: "record-and-review",
    hiddenByDefault: true,
    visibility: "catalog-only",
    defaultStudio: "marketing"
  };

  for (const allowedPath of [
    "../skills/**/SKILL.md",
    "/" + "Users/alice/skills/**/SKILL.md",
    "C:" + String.raw`\Users\alice\skills\**\SKILL.md`,
    "file" + ":skills/**/SKILL.md"
  ]) {
    assert.throws(
      () =>
        validateJsonWithSchema(
          { ...basePack, allowedPaths: [allowedPath] },
          schema,
          { label: "packs/fixture.json" }
        ),
      /allowedPaths.*must match/
    );
  }
});

test("pack schema rejects extra fields and non-https source URLs", async () => {
  const schema = await loadJsonSchema("pack.schema.json");
  const pack = {
    id: "example/pack",
    repoUrl: "http://github.com/example/pack",
    allowedPaths: ["skills/**/SKILL.md"],
    pinPolicy: "sha",
    licensePolicy: "record-and-review",
    hiddenByDefault: true,
    visibility: "catalog-only",
    defaultStudio: "marketing",
    localPath: "/" + "tmp/example"
  };

  assert.throws(
    () => validateJsonWithSchema(pack, schema, { label: "packs/fixture.json" }),
    /repoUrl.*must match|localPath.*not an allowed property/
  );
});
