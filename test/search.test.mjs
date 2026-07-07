import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import {
  buildRerankCandidateCards,
  formatResultsText,
  loadCatalog,
  parsePackReadPath,
  searchCatalog
} from "../src/search.mjs";

const fixtureDir = new URL("./fixtures/catalogs/", import.meta.url);

test("search returns top 3 design results with portable resolved read paths", async () => {
  const catalog = await loadCatalog({ studio: "design", catalogDir: fixtureDir });

  const results = searchCatalog(catalog, "create a launch hero cover image", {
    packRoots: {
      "jimliu/baoyu-skills": "/packs/baoyu-skills"
    }
  });

  assert.ok(results.length > 0);
  assert.ok(results.length <= 3);
  assert.equal(results[0].name, "baoyu-cover-image");
  assert.equal(results[0].sourceCommit, "6b7a2e417500561a5ecdd0b168332f4142584617");
  assert.match(results[0].sourceUrl, /github\.com\/jimliu\/baoyu-skills\/blob\//);
  assert.equal(results[0].source, "jimliu/baoyu-skills");
  assert.equal(results[0].readPath, "/packs/baoyu-skills/skills/baoyu-cover-image/SKILL.md");
  assert.ok(results[0].confidence >= 0.7);
  assert.deepEqual(results[0].capabilities, ["file-write"]);
});

test("search isolates studios so marketing prompts do not return design skills", async () => {
  const catalog = await loadCatalog({ studio: "marketing", catalogDir: fixtureDir });

  const results = searchCatalog(catalog, "position this developer tool for our ICP", {
    packRoots: {
      "coreyhaines31/marketingskills": "/packs/marketingskills"
    }
  });

  assert.equal(results[0].name, "product-marketing");
  assert.ok(results.every((entry) => entry.studio === "marketing"));
});

test("search reports low confidence when no clear match exists", async () => {
  const catalog = await loadCatalog({ studio: "marketing", catalogDir: fixtureDir });

  const results = searchCatalog(catalog, "repair a kubernetes storage class bug", {
    packRoots: {
      "coreyhaines31/marketingskills": "/packs/marketingskills"
    }
  });

  assert.equal(results.length, 0);
});

test("catalog skill paths cannot escape their pack root", async () => {
  const tmpDir = new URL("../.test-tmp/catalogs/", import.meta.url);
  await rm(new URL("../.test-tmp/", import.meta.url), { force: true, recursive: true });
  await mkdir(tmpDir, { recursive: true });
  await writeFile(
    new URL("design.json", tmpDir),
    JSON.stringify([
      {
        name: "escape",
        title: "Escape",
        studio: "design",
        source: "example/pack",
        pack: "example/pack",
        sourceCommit: "0000000000000000000000000000000000000000",
        sourceUrl: "https://github.com/example/pack/blob/0000000000000000000000000000000000000000/skills/escape/SKILL.md",
        skillPath: "../escape/SKILL.md",
        description: "Invalid path should fail before search.",
        capabilities: ["read-only"]
      }
    ])
  );

  await assert.rejects(loadCatalog({ studio: "design", catalogDir: tmpDir }), /pack root/);
});

test("catalog skill paths must be strings", async () => {
  const tmpDir = new URL("../.test-tmp/catalogs/", import.meta.url);
  await rm(new URL("../.test-tmp/", import.meta.url), { force: true, recursive: true });
  await mkdir(tmpDir, { recursive: true });
  await writeFile(
    new URL("design.json", tmpDir),
    JSON.stringify([
      {
        name: "array-path",
        title: "Array Path",
        studio: "design",
        source: "example/pack",
        pack: "example/pack",
        sourceCommit: "0000000000000000000000000000000000000000",
        sourceUrl: "https://github.com/example/pack/blob/0000000000000000000000000000000000000000/skills/array-path/SKILL.md",
        skillPath: ["skills/array-path/SKILL.md"],
        description: "Invalid non-string path should fail before search.",
        capabilities: ["read-only"]
      }
    ])
  );

  await assert.rejects(loadCatalog({ studio: "design", catalogDir: tmpDir }), /skillPath must be a string/);
});

test("catalog array fields must be arrays of strings", async () => {
  const tmpDir = new URL("../.test-tmp/catalogs/", import.meta.url);
  await rm(new URL("../.test-tmp/", import.meta.url), { force: true, recursive: true });
  await mkdir(tmpDir, { recursive: true });
  await writeFile(
    new URL("marketing.json", tmpDir),
    JSON.stringify([
      {
        name: "bad-aliases",
        title: "Bad Aliases",
        studio: "marketing",
        source: "example/pack",
        pack: "example/pack",
        sourceCommit: "0000000000000000000000000000000000000000",
        sourceUrl: "https://github.com/example/pack/blob/0000000000000000000000000000000000000000/skills/bad-aliases/SKILL.md",
        skillPath: "skills/bad-aliases/SKILL.md",
        description: "Invalid aliases should fail before search.",
        aliases: "not-an-array",
        capabilities: ["read-only"]
      }
    ])
  );

  await assert.rejects(loadCatalog({ studio: "marketing", catalogDir: tmpDir }), /aliases must be an array/);
});

test("weak scored entries are filtered out of compact top results", async () => {
  const catalog = [
    {
      name: "exact-launch",
      title: "Exact Launch",
      studio: "marketing",
      source: "example/pack",
      pack: "example/pack",
      sourceCommit: "0000000000000000000000000000000000000000",
      sourceUrl: "https://github.com/example/pack/blob/0000000000000000000000000000000000000000/skills/exact-launch/SKILL.md",
      skillPath: "skills/exact-launch/SKILL.md",
      description: "Use for launch planning.",
      aliases: ["launch"],
      tags: ["launch"],
      capabilities: ["read-only"],
      useWhen: "launch"
    },
    {
      name: "weak-copy",
      title: "Weak Copy",
      studio: "marketing",
      source: "example/pack",
      pack: "example/pack",
      sourceCommit: "0000000000000000000000000000000000000000",
      sourceUrl: "https://github.com/example/pack/blob/0000000000000000000000000000000000000000/skills/weak-copy/SKILL.md",
      skillPath: "skills/weak-copy/SKILL.md",
      description: "A barely related launch mention.",
      aliases: [],
      tags: [],
      capabilities: ["read-only"],
      useWhen: ""
    }
  ];

  const results = searchCatalog(catalog, "exact-launch launch", { limit: 3 });

  assert.equal(results.length, 1);
  assert.equal(results[0].name, "exact-launch");
});

test("pack fallback read paths encode slash-containing pack ids", async () => {
  const catalog = await loadCatalog({ studio: "marketing", catalogDir: fixtureDir });
  const [result] = searchCatalog(catalog, "SEO content plan", { limit: 1 });

  assert.equal(result.readPath, "pack://coreyhaines31%2Fmarketingskills/skills/ai-seo/SKILL.md");
  assert.deepEqual(parsePackReadPath(result.readPath), {
    pack: "coreyhaines31/marketingskills",
    skillPath: "skills/ai-seo/SKILL.md"
  });
});

test("inherited packRoots properties cannot crash read path resolution", () => {
  const catalog = [
    {
      name: "proto",
      title: "Proto",
      studio: "marketing",
      source: "__proto__",
      pack: "__proto__",
      sourceCommit: "0000000000000000000000000000000000000000",
      sourceUrl: "https://github.com/example/proto/blob/0000000000000000000000000000000000000000/skills/proto/SKILL.md",
      skillPath: "skills/proto/SKILL.md",
      description: "Proto search fixture.",
      aliases: ["proto"],
      tags: ["proto"],
      capabilities: ["read-only"],
      useWhen: "proto"
    }
  ];

  const [result] = searchCatalog(catalog, "proto", { packRoots: {} });

  assert.equal(result.readPath, "pack://__proto__/skills/proto/SKILL.md");
});

test("unseeded pricing prompts do not route on generic strategy alone", async () => {
  const catalog = await loadCatalog({ studio: "marketing", catalogDir: fixtureDir });

  const results = searchCatalog(catalog, "pricing strategy", {
    packRoots: {
      "coreyhaines31/marketingskills": "/packs/marketingskills"
    }
  });

  assert.equal(results.length, 0);
});

test("text output includes why, confidence, capabilities, and exact read path", async () => {
  const catalog = await loadCatalog({ studio: "design", catalogDir: fixtureDir });
  const [result] = searchCatalog(catalog, "diagram the runtime architecture", {
    limit: 1,
    packRoots: {
      "jimliu/baoyu-skills": "/packs/baoyu-skills"
    }
  });

  const text = formatResultsText([result]);

  assert.match(text, /baoyu-diagram/);
  assert.match(text, /confidence:/);
  assert.match(text, /capabilities: file-write/);
  assert.match(text, /read: \/packs\/baoyu-skills\/skills\/baoyu-diagram\/SKILL\.md/);
  assert.match(text, /why:/);
});

test("rerank candidate cards exclude full skill bodies by default", async () => {
  const catalog = await loadCatalog({ studio: "marketing", catalogDir: fixtureDir });
  const results = searchCatalog(catalog, "write launch copy", {
    packRoots: {
      "coreyhaines31/marketingskills": "/packs/marketingskills"
    }
  });

  const cards = buildRerankCandidateCards(results);

  assert.ok(cards.length > 0);
  assert.ok(cards.every((card) => !("body" in card)));
  assert.ok(cards.every((card) => card.skillPath.endsWith("/SKILL.md")));
});

test("CLI returns compact JSON with top 3 by default", () => {
  const output = execFileSync(
    process.execPath,
    [
      "bin/debloat-skill-search",
      "marketing",
      "SEO content plan for organic acquisition",
      "--catalog-dir",
      new URL("./fixtures/catalogs", import.meta.url).pathname,
      "--pack-root",
      "coreyhaines31/marketingskills=/packs/marketingskills",
      "--format",
      "json"
    ],
    { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" }
  );

  const parsed = JSON.parse(output);
  assert.equal(parsed.studio, "marketing");
  assert.ok(parsed.results.length > 0);
  assert.ok(parsed.results.length <= 3);
  assert.equal(parsed.results[0].name, "ai-seo");
  assert.ok(parsed.results[0].why.length > 0);
});

test("CLI rejects invalid and missing --limit values", () => {
  for (const args of [
    ["marketing", "SEO content", "--limit", "nope"],
    ["marketing", "SEO content", "--limit", "0"],
    ["marketing", "SEO content", "--limit"]
  ]) {
    assert.throws(
      () =>
        execFileSync(process.execPath, ["bin/debloat-skill-search", ...args], {
          cwd: new URL("..", import.meta.url).pathname,
          encoding: "utf8",
          stdio: "pipe"
        }),
      /--limit/
    );
  }
});
