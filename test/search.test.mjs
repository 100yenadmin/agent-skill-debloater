import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import {
  buildRerankCandidateCards,
  buildVoyageRerankRequest,
  ftsCandidateIndexes,
  formatRerankCandidateDocument,
  formatResultsText,
  loadCatalog,
  parsePackReadPath,
  parsePackRoot,
  parsePackRootsEnv,
  runVoyageRerank,
  searchCatalog
} from "../src/search.mjs";

const fixtureDir = new URL("./fixtures/catalogs/", import.meta.url);

function fixtureEntry(name, overrides = {}) {
  return {
    name,
    title: name,
    studio: "marketing",
    source: "example/pack",
    pack: "example/pack",
    sourceCommit: "0000000000000000000000000000000000000000",
    sourceUrl: `https://github.com/example/pack/blob/0000000000000000000000000000000000000000/skills/${encodeURIComponent(name)}/SKILL.md`,
    skillPath: `skills/${encodeURIComponent(name)}/SKILL.md`,
    description: "Use for shared routing term.",
    aliases: ["shared"],
    tags: ["shared"],
    capabilities: ["read-only"],
    useWhen: "shared",
    ...overrides
  };
}

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

test("CEO catalog routes founder and operating prompts", async () => {
  const catalog = await loadCatalog({ studio: "ceo" });

  assert.equal(searchCatalog(catalog, "think bigger and rethink this plan")[0].name, "plan-ceo-review");
  assert.equal(searchCatalog(catalog, "run a CSO security audit")[0].name, "cso");
  assert.equal(searchCatalog(catalog, "update docs after this release")[0].name, "document-release");
});

test("engineering catalog routes implementation, debugging, review, and subagent prompts", async () => {
  const catalog = await loadCatalog({ studio: "engineering" });

  assert.equal(searchCatalog(catalog, "implement this PRD with tests")[0].name, "implement");
  assert.equal(
    searchCatalog(catalog, "debug this flaky production bug systematically before proposing fixes")[0].name,
    "systematic-debugging"
  );
  {
    const debugResults = searchCatalog(catalog, "debug this flaky production bug", { limit: 3 });
    assert.equal(debugResults[0].name, "diagnosing-bugs");
    assert.ok(
      debugResults[0].score - debugResults[1].score >= 20,
      `expected diagnosing-bugs to have a durable margin, got ${debugResults[0].score} vs ${debugResults[1].score}`
    );
  }
  assert.equal(searchCatalog(catalog, "use TDD and red-green-refactor")[0].name, "tdd");
  assert.equal(
    searchCatalog(catalog, "dispatch subagents for parallel engineering tasks")[0].name,
    "dispatching-parallel-agents"
  );
  assert.equal(
    searchCatalog(catalog, "Use Matt Pocock code review for a two-axis standards and spec review")[0].name,
    "code-review"
  );
  assert.equal(searchCatalog(catalog, "red-green-refactor this feature test first")[0].name, "tdd");
});

test("engineering catalog exposes risky external capability labels", async () => {
  const catalog = await loadCatalog({ studio: "engineering" });
  const byName = new Map(catalog.map((entry) => [entry.name, entry]));
  const requires = {
    "land-and-deploy": ["network", "external-posting", "dangerous"],
    ship: ["network", "external-posting", "dangerous"],
    spec: ["network", "external-posting"],
    "to-issues": ["network", "external-posting"],
    "to-prd": ["network", "external-posting"],
    triage: ["network", "external-posting"],
    "benchmark-models": ["network", "api-key-use"],
    "setup-browser-cookies": ["browser", "customer-data"]
  };

  for (const [name, capabilities] of Object.entries(requires)) {
    const entry = byName.get(name);
    assert.ok(entry, `missing ${name}`);
    for (const capability of capabilities) {
      assert.ok(entry.capabilities.includes(capability), `${name} must include ${capability}`);
    }
  }
});

test("search uses SQLite FTS candidates by default before deterministic scoring", async () => {
  const catalog = await loadCatalog({ studio: "marketing", catalogDir: fixtureDir });
  const queryTokens = ["seo", "content", "plan"];
  let sqliteAvailable = true;

  try {
    assert.deepEqual(ftsCandidateIndexes(catalog, queryTokens, { candidateLimit: 1 }), [1]);
  } catch (error) {
    sqliteAvailable = false;
    if (!/SQLite FTS5 search is unavailable/.test(error.message)) throw error;
  }

  const results = searchCatalog(catalog, "SEO content plan", {
    candidateLimit: sqliteAvailable ? 2 : 40,
    limit: 3,
    packRoots: {
      "coreyhaines31/marketingskills": "/packs/marketingskills"
    }
  });

  assert.equal(results[0].name, "ai-seo");
});

test("saturated FTS candidate caps preserve deterministic top-3 ordering", () => {
  const catalog = [
    ...Array.from({ length: 40 }, (_, index) => fixtureEntry(`z${String(index).padStart(4, "0")}`)),
    ...Array.from({ length: 5 }, (_, index) => fixtureEntry(`a${String(index).padStart(4, "0")}`))
  ];

  const jsonResults = searchCatalog(catalog, "shared", {
    engine: "json",
    limit: 3
  });
  const ftsResults = searchCatalog(catalog, "shared", {
    candidateLimit: 40,
    limit: 3
  });

  assert.deepEqual(
    ftsResults.map((entry) => entry.name),
    jsonResults.map((entry) => entry.name)
  );
  assert.deepEqual(ftsResults.map((entry) => entry.name), ["a0000", "a0001", "a0002"]);
});

test("empty FTS queries preserve raw exact-name deterministic matches", () => {
  const catalog = [
    fixtureEntry("c++", {
      description: "Use for C++ skill routing.",
      aliases: [],
      tags: [],
      useWhen: ""
    })
  ];

  const results = searchCatalog(catalog, "c++", { limit: 1 });

  assert.equal(results.length, 1);
  assert.equal(results[0].name, "c++");
});

test("search rejects invalid FTS candidate limits before fallback", async () => {
  const catalog = await loadCatalog({ studio: "marketing", catalogDir: fixtureDir });

  assert.throws(
    () => searchCatalog(catalog, "SEO content plan", { candidateLimit: 0 }),
    /candidateLimit must be a positive integer/
  );
});

test("search can force the JSON lexical fallback engine", async () => {
  const catalog = await loadCatalog({ studio: "marketing", catalogDir: fixtureDir });

  const results = searchCatalog(catalog, "positioning ICP core offer target audience", {
    engine: "json",
    packRoots: {
      "coreyhaines31/marketingskills": "/packs/marketingskills"
    }
  });

  assert.equal(results[0].name, "product-marketing");
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

test("env pack roots preserve special pack ids as own properties", () => {
  const packRoots = parsePackRootsEnv('{"__proto__":"/env/packs/proto"}');
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

  assert.equal(Object.hasOwn(packRoots, "__proto__"), true);
  const [result] = searchCatalog(catalog, "proto", { packRoots });
  assert.equal(result.readPath, "/env/packs/proto/skills/proto/SKILL.md");
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
  assert.ok(cards.every((card) => !("readPath" in card)));
  assert.ok(cards.every((card) => card.skillPath.endsWith("/SKILL.md")));
});

test("Voyage rerank request uses compact candidate documents only", async () => {
  const catalog = await loadCatalog({ studio: "marketing", catalogDir: fixtureDir });
  const results = searchCatalog(catalog, "write launch copy", {
    packRoots: {
      "coreyhaines31/marketingskills": "/packs/marketingskills"
    }
  });
  const cards = buildRerankCandidateCards(results);
  const contaminated = {
    ...cards[0],
    body: "PRIVATE_FULL_SKILL_BODY",
    readPath: "/private/local/path/SKILL.md"
  };

  const document = formatRerankCandidateDocument(contaminated);
  const request = buildVoyageRerankRequest("write launch copy", [contaminated], {
    model: "rerank-test"
  });

  assert.match(document, /name:/);
  assert.match(document, /skill_path: .*\/SKILL\.md/);
  assert.doesNotMatch(document, /PRIVATE_FULL_SKILL_BODY/);
  assert.doesNotMatch(document, /readPath|body|\/private\/local/);
  assert.deepEqual(request, {
    query: "write launch copy",
    documents: [document],
    model: "rerank-test",
    top_k: 1,
    truncation: true
  });
});

test("Voyage rerank skips cleanly when API key is missing", async () => {
  const catalog = await loadCatalog({ studio: "marketing", catalogDir: fixtureDir });
  const results = searchCatalog(catalog, "SEO content plan");
  const cards = buildRerankCandidateCards(results);
  let called = false;

  const rerank = await runVoyageRerank({
    query: "SEO content plan",
    candidateCards: cards,
    apiKey: "",
    fetchImpl: async () => {
      called = true;
    }
  });

  assert.equal(called, false);
  assert.equal(rerank.status, "skipped-missing-api-key");
  assert.equal(rerank.mode, "shadow");
  assert.equal(rerank.selectedSkillWouldChange, false);
  assert.ok(rerank.candidateCards.length > 0);
});

test("Voyage rerank reports shadow ranking without mutating lexical order", async () => {
  const cards = [
    fixtureEntry("first", {
      description: "General launch copy.",
      useWhen: "launch copy"
    }),
    fixtureEntry("second", {
      description: "Specific SEO launch copy.",
      useWhen: "seo launch copy",
      aliases: ["seo launch"]
    })
  ].map((entry, index) => ({
    ...entry,
    confidence: index === 0 ? 0.9 : 0.7,
    why: [`fixture:${entry.name}`],
    readPath: `/private/${entry.name}/SKILL.md`,
    body: "PRIVATE_FULL_SKILL_BODY"
  }));
  let request;

  const rerank = await runVoyageRerank({
    query: "SEO launch copy",
    candidateCards: cards,
    apiKey: "test-key",
    model: "rerank-test",
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return {
        ok: true,
        json: async () => ({
          data: [
            { index: 1, relevance_score: 0.92123456 },
            { index: 0, relevance_score: 0.12 }
          ]
        })
      };
    }
  });

  assert.equal(request.url, "https://api.voyageai.com/v1/rerank");
  assert.equal(request.options.headers.Authorization, "Bearer test-key");
  assert.equal(request.body.model, "rerank-test");
  assert.equal(request.body.top_k, 2);
  assert.equal(request.body.documents.length, 2);
  assert.doesNotMatch(request.body.documents.join("\n"), /PRIVATE_FULL_SKILL_BODY|readPath|\/private\//);
  assert.equal(rerank.status, "completed");
  assert.deepEqual(
    rerank.ranked.map((row) => row.name),
    ["second", "first"]
  );
  assert.equal(rerank.ranked[0].relevanceScore, 0.921235);
  assert.equal(rerank.selectedSkillWouldChange, true);
  assert.ok(rerank.candidateCards.every((card) => !("body" in card)));
  assert.ok(rerank.candidateCards.every((card) => !("readPath" in card)));
});

test("Voyage rerank treats empty or invalid success payloads as invalid responses", async () => {
  for (const payload of [
    { data: [] },
    { data: [{ index: 99, relevance_score: 0.9 }] },
    { results: [{ index: -1, score: 0.9 }] }
  ]) {
    const rerank = await runVoyageRerank({
      query: "SEO launch copy",
      candidateCards: [
        {
          ...fixtureEntry("first"),
          confidence: 0.9,
          why: ["fixture:first"]
        }
      ],
      apiKey: "test-key",
      fetchImpl: async () => ({
        ok: true,
        json: async () => payload
      })
    });

    assert.equal(rerank.status, "invalid-response");
    assert.equal(rerank.ranked.length, 0);
    assert.equal(rerank.selectedSkillWouldChange, null);
    assert.match(rerank.error, /valid ranked candidates/);
  }
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

test("CLI resolves read paths from AGENT_SKILL_DEBLOATER_PACK_ROOTS", () => {
  const output = execFileSync(
    process.execPath,
    [
      "bin/debloat-skill-search",
      "marketing",
      "SEO content plan for organic acquisition",
      "--catalog-dir",
      new URL("./fixtures/catalogs", import.meta.url).pathname,
      "--format",
      "json"
    ],
    {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_SKILL_DEBLOATER_PACK_ROOTS: JSON.stringify({
          "coreyhaines31/marketingskills": "/env/packs/marketingskills"
        })
      }
    }
  );

  const parsed = JSON.parse(output);
  assert.equal(parsed.results[0].name, "ai-seo");
  assert.equal(parsed.results[0].readPath, "/env/packs/marketingskills/skills/ai-seo/SKILL.md");
});

test("CLI --pack-root overrides AGENT_SKILL_DEBLOATER_PACK_ROOTS", () => {
  const output = execFileSync(
    process.execPath,
    [
      "bin/debloat-skill-search",
      "marketing",
      "SEO content plan for organic acquisition",
      "--catalog-dir",
      new URL("./fixtures/catalogs", import.meta.url).pathname,
      "--pack-root",
      "coreyhaines31/marketingskills=/flag/packs/marketingskills",
      "--format",
      "json"
    ],
    {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_SKILL_DEBLOATER_PACK_ROOTS: JSON.stringify({
          "coreyhaines31/marketingskills": "/env/packs/marketingskills"
        })
      }
    }
  );

  const parsed = JSON.parse(output);
  assert.equal(parsed.results[0].readPath, "/flag/packs/marketingskills/skills/ai-seo/SKILL.md");
});

test("--pack-root rejects empty pack ids and roots", () => {
  for (const value of ["=root", "example/pack="]) {
    assert.throws(() => parsePackRoot(value), /--pack-root/);
  }
});

test("AGENT_SKILL_DEBLOATER_PACK_ROOTS rejects malformed values", () => {
  assert.equal(Object.getPrototypeOf(parsePackRootsEnv("")), null);

  for (const value of ["not-json", "[]", JSON.stringify({ "example/pack": "" })]) {
    assert.throws(() => parsePackRootsEnv(value), /AGENT_SKILL_DEBLOATER_PACK_ROOTS/);
  }
});

test("CLI can force JSON fallback search engine", () => {
  const output = execFileSync(
    process.execPath,
    [
      "bin/debloat-skill-search",
      "marketing",
      "positioning ICP core offer target audience",
      "--catalog-dir",
      new URL("./fixtures/catalogs", import.meta.url).pathname,
      "--engine",
      "json",
      "--format",
      "json"
    ],
    { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" }
  );

  const parsed = JSON.parse(output);
  assert.equal(parsed.results[0].name, "product-marketing");
});

test("CLI returns Voyage shadow metadata without an API key", () => {
  const output = execFileSync(
    process.execPath,
    [
      "bin/debloat-skill-search",
      "marketing",
      "SEO content plan for organic acquisition",
      "--catalog-dir",
      new URL("./fixtures/catalogs", import.meta.url).pathname,
      "--rerank",
      "voyage",
      "--format",
      "json"
    ],
    {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
      env: { ...process.env, VOYAGE_API_KEY: "" }
    }
  );

  const parsed = JSON.parse(output);
  assert.equal(parsed.results[0].name, "ai-seo");
  assert.equal(parsed.rerank.provider, "voyage");
  assert.equal(parsed.rerank.mode, "shadow");
  assert.equal(parsed.rerank.status, "skipped-missing-api-key");
  assert.ok(parsed.rerank.candidateCards.every((card) => !("body" in card)));
  assert.ok(parsed.rerank.candidateCards.every((card) => !("readPath" in card)));
});

test("CLI rejects invalid usage values", () => {
  for (const [args, pattern] of [
    [["marketing", "SEO content", "--limit", "nope"], /--limit/],
    [["marketing", "SEO content", "--limit", "0"], /--limit/],
    [["marketing", "SEO content", "--limit"], /--limit/],
    [["marketing", "SEO content", "--pack-root", "coreyhaines31/marketingskills="], /--pack-root/]
  ]) {
    assert.throws(
      () =>
        execFileSync(process.execPath, ["bin/debloat-skill-search", ...args], {
          cwd: new URL("..", import.meta.url).pathname,
          encoding: "utf8",
          stdio: "pipe"
        }),
      pattern
    );
  }
});
