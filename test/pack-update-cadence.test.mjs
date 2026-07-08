import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import {
  buildPackUpdatePacket,
  buildPackUpdatePrBody,
  packUpdateBranchName
} from "../src/pack-update-cadence.mjs";

const SHA_1 = "1111111111111111111111111111111111111111";
const SHA_2 = "2222222222222222222222222222222222222222";
const SHA_3 = "3333333333333333333333333333333333333333";
const SHA_4 = "4444444444444444444444444444444444444444";
const SHA_5 = "5555555555555555555555555555555555555555";
const SHA_6 = "6666666666666666666666666666666666666666";
const SHA_7 = "7777777777777777777777777777777777777777";

function diffReport() {
  return {
    ok: true,
    pack: "example/pack",
    from: {
      resolvedRef: "main",
      resolvedSha: SHA_1
    },
    to: {
      resolvedRef: "release-2026-07-08",
      resolvedSha: SHA_2
    },
    changes: {
      added: [
        {
          path: "skills/new-skill/SKILL.md",
          blobSha: SHA_3
        }
      ],
      removed: [
        {
          path: "skills/old-skill/SKILL.md",
          blobSha: SHA_4
        }
      ],
      movedOrRenamed: [
        {
          from: "skills/moved/SKILL.md",
          to: "skills/renamed/SKILL.md",
          blobSha: SHA_5
        }
      ],
      bodyChanged: [
        {
          path: "skills/body/SKILL.md",
          fromBlobSha: SHA_6,
          toBlobSha: SHA_7
        }
      ],
      missingCurrentHashes: ["skills/missing-hash/SKILL.md"],
      unchangedCount: 2,
      license: {
        changed: true,
        fromBlobSha: SHA_1,
        toBlobSha: SHA_2,
        path: "LICENSE"
      }
    }
  };
}

function updateResult() {
  return {
    ok: true,
    pack: "example/pack",
    updated: ["locks/example.lock.json", "catalogs/marketing.json"]
  };
}

test("pack update packet captures deterministic drift counts and review gates", () => {
  const packet = buildPackUpdatePacket({
    diffReport: diffReport(),
    updateResult: updateResult()
  });

  assert.equal(packet.suite, "pack-update-cadence/v0");
  assert.equal(packet.pack, "example/pack");
  assert.equal(packet.changes.skillChangeCount, 5);
  assert.equal(packet.changes.added, 1);
  assert.equal(packet.changes.removed, 1);
  assert.equal(packet.changes.movedOrRenamed, 1);
  assert.equal(packet.changes.bodyChanged, 1);
  assert.equal(packet.changes.missingCurrentHashes, 1);
  assert.equal(packet.changes.license.changed, true);
  assert.deepEqual(packet.updatedFiles, ["catalogs/marketing.json", "locks/example.lock.json"]);
  assert.ok(packet.reviewGates.includes("catalog-review-for-new-skills"));
  assert.ok(packet.reviewGates.includes("blocking-license-review"));
  assert.ok(packet.validationCommands.includes("npm run eval:routing"));
  assert.match(packet.proofBoundary, /does not make new upstream skills router-visible/i);
});

test("pack update PR body includes provenance diff, eval commands, and proof boundary", () => {
  const body = buildPackUpdatePrBody({
    diffReport: diffReport(),
    updateResult: updateResult()
  });

  assert.match(body, /## Provenance Diff/);
  assert.match(body, /skills\/new-skill\/SKILL\.md/);
  assert.match(body, /skills\/moved\/SKILL\.md -> skills\/renamed\/SKILL\.md/);
  assert.match(body, /blocking-license-review/);
  assert.match(body, /`npm run eval:routing`/);
  assert.match(body, /`npm run eval:rerank`/);
  assert.match(body, /Release Note Fragment/);
  assert.match(body, /does not make new upstream skills router-visible/);
  assert.doesNotMatch(body, /customer VM\/fleet readiness is proven/i);
});

test("pack update branch names are deterministic and shell-safe", () => {
  assert.equal(
    packUpdateBranchName({
      pack: "coreyhaines31/marketingskills",
      to: "release/2026.07.08",
      prefix: "pack-update/12345"
    }),
    "pack-update/12345/coreyhaines31-marketingskills-release-2026.07.08"
  );
});

test("pack update cadence CLI writes packet, PR body, and branch files", async () => {
  const tmpRoot = new URL("./.test-tmp/pack-update-cadence-cli/", import.meta.url);
  await rm(tmpRoot, { force: true, recursive: true });
  await mkdir(tmpRoot, { recursive: true });
  const diffPath = new URL("diff.json", tmpRoot);
  const updatePath = new URL("update.json", tmpRoot);
  const packetPath = new URL("packet.json", tmpRoot);
  const bodyPath = new URL("body.md", tmpRoot);
  const branchPath = new URL("branch.txt", tmpRoot);
  await writeFile(diffPath, JSON.stringify(diffReport()));
  await writeFile(updatePath, JSON.stringify(updateResult()));

  execFileSync(process.execPath, [
    "src/pack-update-cadence.mjs",
    "packet",
    "--diff",
    diffPath.pathname,
    "--update",
    updatePath.pathname,
    "--output",
    packetPath.pathname
  ]);
  execFileSync(process.execPath, [
    "src/pack-update-cadence.mjs",
    "pr-body",
    "--diff",
    diffPath.pathname,
    "--update",
    updatePath.pathname,
    "--output",
    bodyPath.pathname
  ]);
  execFileSync(process.execPath, [
    "src/pack-update-cadence.mjs",
    "branch-name",
    "--pack",
    "example/pack",
    "--to",
    "release/2026.07.08",
    "--prefix",
    "pack-update/999",
    "--output",
    branchPath.pathname
  ]);

  const packet = JSON.parse(await readFile(packetPath, "utf8"));
  const body = await readFile(bodyPath, "utf8");
  const branch = await readFile(branchPath, "utf8");

  assert.equal(packet.suite, "pack-update-cadence/v0");
  assert.match(body, /## Proof Boundary/);
  assert.equal(branch.trim(), "pack-update/999/example-pack-release-2026.07.08");
});
