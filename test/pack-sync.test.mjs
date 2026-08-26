import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import { checkPackMetadata, diffPackMetadata, updatePackMetadata } from "../src/pack-sync.mjs";

const SHA = "0000000000000000000000000000000000000000";
const SHA_1 = "1111111111111111111111111111111111111111";
const SHA_2 = "2222222222222222222222222222222222222222";
const SHA_3 = "3333333333333333333333333333333333333333";
const SHA_4 = "4444444444444444444444444444444444444444";
const SHA_5 = "5555555555555555555555555555555555555555";
const SHA_6 = "6666666666666666666666666666666666666666";
const SHA_7 = "7777777777777777777777777777777777777777";
const SHA_8 = "8888888888888888888888888888888888888888";

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
        packs: [],
        plannedPacks: ["future/pack"],
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

  const traversal = await makePackRoot("license-path-traversal", {
    lock: {
      license: {
        status: "recorded",
        sourceUrl: `https://github.com/example/pack/blob/${SHA}/../other-repo/LICENSE`
      }
    }
  });
  await assert.rejects(checkPackMetadata({ root: traversal }), /license\.sourceUrl/);
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

test("pack-sync rejects lock skill paths outside manifest allowedPaths", async () => {
  const root = await makePackRoot("lock-skill-outside-allowed-paths", {
    lock: {
      skills: [
        { path: "skills/example-skill/SKILL.md", blobSha: SHA_1 },
        { path: "other/example-skill/SKILL.md", blobSha: SHA_2 }
      ]
    }
  });

  await assert.rejects(checkPackMetadata({ root }), /Lock example\/pack skills\[1\]\.path is outside manifest allowedPaths/);
});

test("pack-sync rejects lock skill records that omit curated catalog paths", async () => {
  const root = await makePackRoot("lock-skills-omit-catalog-path", {
    lock: {
      skills: [{ path: "skills/other-skill/SKILL.md", blobSha: SHA_1 }]
    }
  });

  await assert.rejects(
    checkPackMetadata({ root }),
    /Lock example\/pack skills is missing catalog skillPath skills\/example-skill\/SKILL\.md/
  );
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

test("pack-sync allows deferred studios to track future packs outside active pack bindings", async () => {
  const root = await makePackRoot("deferred-future-pack");

  const result = await checkPackMetadata({ root });

  assert.equal(result.ok, true);
});

test("pack-sync rejects deferred studio pack bindings without declared manifests", async () => {
  const root = await makePackRoot("deferred-undeclared-pack-binding", {
    extraFiles: [
      {
        path: "overlays/studios.json",
        json: {
          studios: {
            deferred: {
              displayName: "Deferred Studio",
              status: "deferred",
              packs: ["future/pack"],
              description: "Broken deferred pack binding."
            }
          }
        }
      }
    ]
  });

  await assert.rejects(checkPackMetadata({ root }), /Overlay studio deferred references undeclared pack future\/pack/);
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

test("pack-sync diff reports deterministic upstream add, remove, move, body, and license changes", async () => {
  const root = await makePackRoot("diff-report", {
    lock: {
      skills: [
        { path: "skills/changed/SKILL.md", blobSha: SHA_1 },
        { path: "skills/old-name/SKILL.md", blobSha: SHA_2 },
        { path: "skills/removed/SKILL.md", blobSha: SHA_3 },
        { path: "skills/unchanged/SKILL.md", blobSha: SHA_4 }
      ],
      license: {
        status: "recorded",
        sourceUrl: `https://github.com/example/pack/blob/${SHA}/LICENSE`,
        blobSha: SHA_5
      }
    }
  });

  const report = await diffPackMetadata({
    root,
    packId: "example/pack",
    target: {
      resolvedRef: "main",
      resolvedSha: SHA_1,
      license: { path: "LICENSE", blobSha: SHA_8 },
      skills: [
        { path: "skills/added/SKILL.md", blobSha: SHA_7 },
        { path: "skills/changed/SKILL.md", blobSha: SHA_6 },
        { path: "skills/new-name/SKILL.md", blobSha: SHA_2 },
        { path: "skills/unchanged/SKILL.md", blobSha: SHA_4 }
      ]
    }
  });
  const lockAfterDiff = JSON.parse(await readFile(new URL("locks/example.lock.json", root), "utf8"));

  assert.deepEqual(report.changes.added, [{ path: "skills/added/SKILL.md", blobSha: SHA_7 }]);
  assert.deepEqual(report.changes.removed, [{ path: "skills/removed/SKILL.md", blobSha: SHA_3 }]);
  assert.deepEqual(report.changes.movedOrRenamed, [
    {
      from: "skills/old-name/SKILL.md",
      to: "skills/new-name/SKILL.md",
      blobSha: SHA_2
    }
  ]);
  assert.deepEqual(report.changes.bodyChanged, [
    {
      path: "skills/changed/SKILL.md",
      fromBlobSha: SHA_1,
      toBlobSha: SHA_6
    }
  ]);
  assert.equal(report.changes.unchangedCount, 1);
  assert.deepEqual(report.changes.license, {
    changed: true,
    fromBlobSha: SHA_5,
    toBlobSha: SHA_8,
    path: "LICENSE"
  });
  assert.equal(lockAfterDiff.resolvedSha, SHA);
  assert.deepEqual(
    lockAfterDiff.skills,
    [
      { path: "skills/changed/SKILL.md", blobSha: SHA_1 },
      { path: "skills/old-name/SKILL.md", blobSha: SHA_2 },
      { path: "skills/removed/SKILL.md", blobSha: SHA_3 },
      { path: "skills/unchanged/SKILL.md", blobSha: SHA_4 }
    ]
  );
});

test("pack-sync update writes resolved lock provenance and catalog source URLs", async () => {
  const root = await makePackRoot("update-lock-and-catalog", {
    lock: {
      skills: [{ path: "skills/example-skill/SKILL.md", blobSha: SHA_1 }],
      license: {
        status: "recorded",
        sourceUrl: `https://github.com/example/pack/blob/${SHA}/LICENSE`,
        blobSha: SHA_2
      }
    }
  });

  const result = await updatePackMetadata({
    root,
    packId: "example/pack",
    resolvedAt: "2026-07-08",
    target: {
      resolvedRef: "main",
      resolvedSha: SHA_3,
      license: { path: "LICENSE", blobSha: SHA_4 },
      skills: [{ path: "skills/example-skill/SKILL.md", blobSha: SHA_5 }]
    }
  });

  const lock = JSON.parse(await readFile(new URL("locks/example.lock.json", root), "utf8"));
  const catalog = JSON.parse(await readFile(new URL("catalogs/marketing.json", root), "utf8"));

  assert.equal(result.ok, true);
  assert.equal(lock.resolvedRef, "main");
  assert.equal(lock.resolvedSha, SHA_3);
  assert.equal(lock.resolvedAt, "2026-07-08");
  assert.equal(lock.license.sourceUrl, `https://github.com/example/pack/blob/${SHA_3}/LICENSE`);
  assert.equal(lock.license.blobSha, SHA_4);
  assert.deepEqual(lock.skills, [{ path: "skills/example-skill/SKILL.md", blobSha: SHA_5 }]);
  assert.equal(catalog[0].sourceCommit, SHA_3);
  assert.equal(
    catalog[0].sourceUrl,
    `https://github.com/example/pack/blob/${SHA_3}/skills/example-skill/SKILL.md`
  );
  assert.deepEqual(result.updated, ["locks/example.lock.json", "catalogs/marketing.json"]);
});

test("pack-sync update reports no updated files when lock and catalog content are unchanged", async () => {
  const root = await makePackRoot("update-noop", {
    lock: {
      resolvedRef: "main",
      resolvedSha: SHA_3,
      resolvedAt: "2026-07-08",
      skills: [{ path: "skills/example-skill/SKILL.md", blobSha: SHA_5 }],
      license: {
        status: "recorded",
        sourceUrl: `https://github.com/example/pack/blob/${SHA_3}/LICENSE`,
        blobSha: SHA_4
      }
    },
    entry: {
      sourceCommit: SHA_3,
      sourceUrl: `https://github.com/example/pack/blob/${SHA_3}/skills/example-skill/SKILL.md`
    }
  });

  const result = await updatePackMetadata({
    root,
    packId: "example/pack",
    resolvedAt: "2026-07-08",
    target: {
      resolvedRef: "main",
      resolvedSha: SHA_3,
      license: { path: "LICENSE", blobSha: SHA_4 },
      skills: [{ path: "skills/example-skill/SKILL.md", blobSha: SHA_5 }]
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.updated, []);
});

test("pack-sync CLI diff and update accept fixture target trees", async () => {
  const root = await makePackRoot("cli-diff-update", {
    lock: {
      skills: [{ path: "skills/example-skill/SKILL.md", blobSha: SHA_1 }],
      license: {
        status: "recorded",
        sourceUrl: `https://github.com/example/pack/blob/${SHA}/LICENSE`,
        blobSha: SHA_2
      }
    }
  });
  const targetPath = new URL("target-tree.json", root);
  await writeJson(targetPath, {
    resolvedRef: "release",
    resolvedSha: SHA_3,
    license: { path: "LICENSE", blobSha: SHA_4 },
    skills: [{ path: "skills/example-skill/SKILL.md", blobSha: SHA_5 }]
  });

  const diffOutput = execFileSync(
    process.execPath,
    ["bin/pack-sync", "diff", "--root", root.pathname, "--pack", "example/pack", "--target-tree", targetPath.pathname],
    { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" }
  );
  const diff = JSON.parse(diffOutput);
  assert.equal(diff.to.resolvedSha, SHA_3);
  assert.equal(diff.changes.bodyChanged[0].path, "skills/example-skill/SKILL.md");

  const updateOutput = execFileSync(
    process.execPath,
    [
      "bin/pack-sync",
      "update",
      "--root",
      root.pathname,
      "--pack",
      "example/pack",
      "--target-tree",
      targetPath.pathname,
      "--resolved-at",
      "2026-07-08"
    ],
    { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" }
  );
  const update = JSON.parse(updateOutput);
  const lock = JSON.parse(await readFile(new URL("locks/example.lock.json", root), "utf8"));

  assert.equal(update.ok, true);
  assert.equal(lock.resolvedRef, "release");
  assert.equal(lock.resolvedSha, SHA_3);
  assert.deepEqual(lock.skills, [{ path: "skills/example-skill/SKILL.md", blobSha: SHA_5 }]);
});

test("pack-sync diff reports missing current skill hashes instead of fake body changes", async () => {
  const root = await makePackRoot("diff-missing-current-hashes");

  const report = await diffPackMetadata({
    root,
    packId: "example/pack",
    target: {
      resolvedRef: "main",
      resolvedSha: SHA_1,
      license: { path: "LICENSE", blobSha: SHA_2 },
      skills: [{ path: "skills/example-skill/SKILL.md", blobSha: SHA_3 }]
    }
  });

  assert.deepEqual(report.changes.added, []);
  assert.deepEqual(report.changes.removed, []);
  assert.deepEqual(report.changes.bodyChanged, []);
  assert.deepEqual(report.changes.missingCurrentHashes, ["skills/example-skill/SKILL.md"]);
});

test("pack-sync diff and update reject target skill paths outside manifest allowedPaths before writing", async () => {
  const root = await makePackRoot("target-outside-allowed-paths", {
    lock: {
      skills: [{ path: "skills/example-skill/SKILL.md", blobSha: SHA_1 }]
    }
  });
  const before = await readFile(new URL("locks/example.lock.json", root), "utf8");
  const target = {
    resolvedRef: "main",
    resolvedSha: SHA_2,
    license: { path: "LICENSE", blobSha: SHA_3 },
    skills: [
      { path: "skills/example-skill/SKILL.md", blobSha: SHA_4 },
      { path: "other/example-skill/SKILL.md", blobSha: SHA_5 }
    ]
  };

  await assert.rejects(
    diffPackMetadata({ root, packId: "example/pack", target }),
    /target.skills\[1\]\.path is outside manifest allowedPaths/
  );
  await assert.rejects(
    updatePackMetadata({ root, packId: "example/pack", target }),
    /target.skills\[1\]\.path is outside manifest allowedPaths/
  );

  assert.equal(await readFile(new URL("locks/example.lock.json", root), "utf8"), before);
});

test("pack-sync update rejects invalid resolvedAt before writing", async () => {
  const root = await makePackRoot("invalid-resolved-at-before-write", {
    lock: {
      skills: [{ path: "skills/example-skill/SKILL.md", blobSha: SHA_1 }]
    }
  });
  const before = await readFile(new URL("locks/example.lock.json", root), "utf8");

  await assert.rejects(
    updatePackMetadata({
      root,
      packId: "example/pack",
      resolvedAt: "today",
      target: {
        resolvedRef: "main",
        resolvedSha: SHA_2,
        license: { path: "LICENSE", blobSha: SHA_3 },
        skills: [{ path: "skills/example-skill/SKILL.md", blobSha: SHA_4 }]
      }
    }),
    /resolvedAt must match YYYY-MM-DD/
  );

  assert.equal(await readFile(new URL("locks/example.lock.json", root), "utf8"), before);
});

test("pack-sync diff and update reject target license paths other than LICENSE before writing", async () => {
  const root = await makePackRoot("target-license-not-license", {
    lock: {
      skills: [{ path: "skills/example-skill/SKILL.md", blobSha: SHA_1 }]
    }
  });
  const before = await readFile(new URL("locks/example.lock.json", root), "utf8");
  const target = {
    resolvedRef: "main",
    resolvedSha: SHA_2,
    license: { path: "skills/example-skill/SKILL.md", blobSha: SHA_3 },
    skills: [{ path: "skills/example-skill/SKILL.md", blobSha: SHA_4 }]
  };

  await assert.rejects(
    diffPackMetadata({ root, packId: "example/pack", target }),
    /target\.license\.path must be LICENSE/
  );
  await assert.rejects(
    updatePackMetadata({ root, packId: "example/pack", target }),
    /target\.license\.path must be LICENSE/
  );

  assert.equal(await readFile(new URL("locks/example.lock.json", root), "utf8"), before);
});
