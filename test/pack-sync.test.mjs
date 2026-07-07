import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import { checkPackMetadata } from "../src/pack-sync.mjs";

const SHA = "0000000000000000000000000000000000000000";

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function makePackRoot(name, { pack = {}, lock = {}, entry = {}, extraFiles = [] } = {}) {
  const root = new URL(`./.test-tmp/pack-sync/${name}/`, import.meta.url);
  await rm(root, { force: true, recursive: true });
  for (const dir of ["packs", "locks", "overlays", "catalogs"]) {
    await mkdir(new URL(`${dir}/`, root), { recursive: true });
  }

  const packJson = {
    id: "example/pack",
    repoUrl: "https://github.com/example/pack",
    allowedPaths: ["skills/**/SKILL.md"],
    pinPolicy: "sha",
    licensePolicy: "record-and-review",
    hiddenByDefault: true,
    visibility: "catalog-only",
    defaultStudio: "marketing",
    ...pack
  };
  const lockJson = {
    pack: "example/pack",
    repoUrl: "https://github.com/example/pack",
    resolvedRef: "main",
    resolvedSha: SHA,
    resolvedAt: "2026-07-07",
    license: {
      status: "recorded",
      sourceUrl: `https://github.com/example/pack/blob/${SHA}/LICENSE`
    },
    catalogs: ["catalogs/marketing.json"],
    ...lock
  };
  const entryJson = {
    name: "example-skill",
    title: "Example Skill",
    studio: "marketing",
    source: "example/pack",
    pack: "example/pack",
    sourceCommit: SHA,
    sourceUrl: `https://github.com/example/pack/blob/${SHA}/skills/example-skill/SKILL.md`,
    skillPath: "skills/example-skill/SKILL.md",
    description: "Example catalog entry.",
    aliases: [],
    tags: [],
    capabilities: ["read-only"],
    ...entry
  };

  if (packJson) await writeJson(new URL("packs/example.json", root), packJson);
  if (lockJson) await writeJson(new URL("locks/example.lock.json", root), lockJson);
  await writeJson(new URL("overlays/studios.json", root), {
    studios: {
      marketing: {
        displayName: "Marketing Studio",
        visibleRouterSkill: "marketing-studio",
        packs: ["example/pack"],
        defaultLimit: 3,
        description: "Marketing fixture studio."
      },
      deferred: {
        displayName: "Deferred Studio",
        status: "deferred",
        packs: ["future/pack"],
        description: "Deferred fixture studio."
      }
    }
  });
  await writeJson(new URL("catalogs/marketing.json", root), [entryJson]);

  for (const { path, json } of extraFiles) {
    await writeJson(new URL(path, root), json);
  }

  return root;
}

test("pack-sync validates declared pack, lock, catalog source URL, and allowed path", async () => {
  const root = await makePackRoot("valid");

  const result = await checkPackMetadata({ root });

  assert.equal(result.ok, true);
  assert.ok(result.checked.includes("packs/example.json"));
});

test("pack-sync rejects catalog entries without a declared pack manifest", async () => {
  const root = await makePackRoot("undeclared-pack", {
    pack: null,
    lock: { pack: "evil/pack", repoUrl: "https://github.com/evil/pack" },
    entry: {
      source: "evil/pack",
      pack: "evil/pack",
      sourceUrl: `https://github.com/evil/pack/blob/${SHA}/skills/example-skill/SKILL.md`
    }
  });

  await rm(new URL("packs/example.json", root), { force: true });

  await assert.rejects(checkPackMetadata({ root }), /undeclared pack/);
});

test("pack-sync rejects spoofed catalog source metadata", async () => {
  const root = await makePackRoot("spoofed-source-url", {
    entry: {
      sourceUrl: `https://github.com/other/repo/blob/${SHA}/skills/example-skill/SKILL.md`
    }
  });

  await assert.rejects(checkPackMetadata({ root }), /sourceUrl/);
});

test("pack-sync rejects pack repoUrl that does not match the pack id", async () => {
  const root = await makePackRoot("spoofed-repo-url", {
    pack: {
      repoUrl: "https://github.com/other/pack"
    },
    lock: {
      repoUrl: "https://github.com/other/pack"
    },
    entry: {
      sourceUrl: `https://github.com/other/pack/blob/${SHA}/skills/example-skill/SKILL.md`
    }
  });

  await assert.rejects(checkPackMetadata({ root }), /Pack example\/pack repoUrl must be https:\/\/github.com\/example\/pack/);
});

test("pack-sync rejects license URLs outside the locked repo and SHA", async () => {
  const wrongRepo = await makePackRoot("license-wrong-repo", {
    lock: {
      license: {
        status: "recorded",
        sourceUrl: `https://github.com/other/pack/blob/${SHA}/LICENSE`
      }
    }
  });
  await assert.rejects(checkPackMetadata({ root: wrongRepo }), /license\.sourceUrl/);

  const wrongSha = await makePackRoot("license-wrong-sha", {
    lock: {
      license: {
        status: "recorded",
        sourceUrl: "https://github.com/example/pack/blob/1111111111111111111111111111111111111111/LICENSE"
      }
    }
  });
  await assert.rejects(checkPackMetadata({ root: wrongSha }), /license\.sourceUrl/);
});

test("pack-sync rejects catalog paths outside manifest allowedPaths", async () => {
  const root = await makePackRoot("outside-allowed-paths", {
    entry: {
      sourceUrl: `https://github.com/example/pack/blob/${SHA}/other/example-skill/SKILL.md`,
      skillPath: "other/example-skill/SKILL.md"
    }
  });

  await assert.rejects(checkPackMetadata({ root }), /allowedPaths/);
});

test("pack-sync rejects duplicate pack and lock identities", async () => {
  const duplicatePackRoot = await makePackRoot("duplicate-pack", {
    extraFiles: [
      {
        path: "packs/duplicate.json",
        json: {
          id: "example/pack",
          repoUrl: "https://github.com/example/pack",
          allowedPaths: ["skills/**/SKILL.md"],
          pinPolicy: "sha",
          licensePolicy: "record-and-review",
          hiddenByDefault: true,
          visibility: "catalog-only",
          defaultStudio: "marketing"
        }
      }
    ]
  });
  await assert.rejects(checkPackMetadata({ root: duplicatePackRoot }), /Duplicate pack id/);

  const duplicateLockRoot = await makePackRoot("duplicate-lock", {
    extraFiles: [
      {
        path: "locks/duplicate.lock.json",
        json: {
          pack: "example/pack",
          repoUrl: "https://github.com/example/pack",
          resolvedRef: "main",
          resolvedSha: SHA,
          resolvedAt: "2026-07-07",
          license: {
            status: "recorded",
            sourceUrl: `https://github.com/example/pack/blob/${SHA}/LICENSE`
          },
          catalogs: ["catalogs/marketing.json"]
        }
      }
    ]
  });
  await assert.rejects(checkPackMetadata({ root: duplicateLockRoot }), /Duplicate lock pack/);
});

test("pack-sync rejects absolute and file URL path-bearing fields", async () => {
  const workspacePath = "/" + "workspaces/example/skills/example-skill/SKILL.md";
  const absoluteRoot = await makePackRoot("absolute-path", {
    entry: {
      sourceUrl: `file://${workspacePath}`,
      skillPath: workspacePath
    }
  });

  await assert.rejects(checkPackMetadata({ root: absoluteRoot }), /Schema validation|absolute|file:/);
});

test("pack-sync allows deferred studios to reference future packs", async () => {
  const root = await makePackRoot("deferred-future-pack");

  const result = await checkPackMetadata({ root });

  assert.equal(result.ok, true);
});

test("pack-sync rejects active overlays that reference undeclared packs", async () => {
  const root = await makePackRoot("active-overlay-undeclared-pack", {
    extraFiles: [
      {
        path: "overlays/studios.json",
        json: {
          studios: {
            marketing: {
              displayName: "Marketing Studio",
              visibleRouterSkill: "marketing-studio",
              packs: ["missing/pack"],
              defaultLimit: 3,
              description: "Broken active studio."
            }
          }
        }
      }
    ]
  });

  await assert.rejects(checkPackMetadata({ root }), /Overlay studio marketing references undeclared pack missing\/pack/);
});

test("pack-sync rejects invalid overlay studio ids", async () => {
  const root = await makePackRoot("invalid-overlay-studio-id", {
    extraFiles: [
      {
        path: "overlays/studios.json",
        json: {
          studios: {
            "Marketing Studio": {
              displayName: "Marketing Studio",
              visibleRouterSkill: "marketing-studio",
              packs: ["example/pack"],
              defaultLimit: 3,
              description: "Broken studio id."
            }
          }
        }
      }
    ]
  });

  await assert.rejects(checkPackMetadata({ root }), /must be lowercase kebab-case/);
});

test("pack-sync rejects catalog entries in the wrong studio catalog", async () => {
  const root = await makePackRoot("wrong-studio-catalog", {
    entry: {
      studio: "design"
    }
  });

  await assert.rejects(checkPackMetadata({ root }), /Catalog catalogs\/marketing\.json contains example-skill for studio design/);
});

test("pack-sync rejects lockfiles that reference missing catalogs", async () => {
  const root = await makePackRoot("missing-lock-catalog", {
    lock: {
      catalogs: ["catalogs/missing.json"]
    }
  });

  await assert.rejects(checkPackMetadata({ root }), /references missing catalog catalogs\/missing\.json/);
});

test("pack-sync rejects catalogs omitted from lockfile coverage", async () => {
  const root = await makePackRoot("lock-omits-catalog-coverage", {
    extraFiles: [
      {
        path: "overlays/studios.json",
        json: {
          studios: {
            marketing: {
              displayName: "Marketing Studio",
              visibleRouterSkill: "marketing-studio",
              packs: ["example/pack"],
              defaultLimit: 3,
              description: "Marketing fixture studio."
            },
            design: {
              displayName: "Design Studio",
              visibleRouterSkill: "design-studio",
              packs: ["example/pack"],
              defaultLimit: 3,
              description: "Design fixture studio."
            }
          }
        }
      },
      {
        path: "catalogs/design.json",
        json: [
          {
            name: "example-design",
            title: "Example Design",
            studio: "design",
            source: "example/pack",
            pack: "example/pack",
            sourceCommit: SHA,
            sourceUrl: `https://github.com/example/pack/blob/${SHA}/skills/example-design/SKILL.md`,
            skillPath: "skills/example-design/SKILL.md",
            description: "Extra catalog entry omitted from lock coverage.",
            aliases: [],
            tags: [],
            capabilities: ["read-only"]
          }
        ]
      }
    ]
  });

  await assert.rejects(checkPackMetadata({ root }), /catalogs do not match catalog coverage/);
});
