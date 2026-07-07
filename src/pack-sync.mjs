import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertNoMachineLocalPaths } from "./portable-paths.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsonDirs = ["packs", "locks", "overlays", "catalogs"];

async function readJsonFile(file) {
  const body = await readFile(file, "utf8");
  assertNoMachineLocalPaths(body, file);
  return { file, json: JSON.parse(body) };
}

async function listJson(dir) {
  const absolute = path.join(repoRoot, dir);
  const entries = await readdir(absolute, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(absolute, entry.name));
}

export async function checkPackMetadata() {
  const checked = [];
  const packs = new Map();
  const locks = new Map();
  const catalogs = [];

  for (const dir of jsonDirs) {
    for (const file of await listJson(dir)) {
      const parsed = await readJsonFile(file);
      checked.push(parsed.file);

      if (dir === "packs") packs.set(parsed.json.id, parsed.json);
      if (dir === "locks") locks.set(parsed.json.pack, parsed.json);
      if (dir === "catalogs") catalogs.push(...parsed.json);
    }
  }

  for (const [packId, pack] of packs) {
    const lock = locks.get(packId);
    if (pack.pinPolicy === "sha" && !lock) {
      throw new Error(`Pack ${packId} uses pinPolicy=sha but has no lockfile`);
    }
    if (lock && !/^[a-f0-9]{40}$/.test(lock.resolvedSha ?? "")) {
      throw new Error(`Pack ${packId} lockfile is missing a 40-character resolvedSha`);
    }
  }

  for (const entry of catalogs) {
    const lock = locks.get(entry.pack);
    if (!lock) throw new Error(`Catalog entry ${entry.name} references unlocked pack ${entry.pack}`);
    if (entry.sourceCommit !== lock.resolvedSha) {
      throw new Error(`Catalog entry ${entry.name} sourceCommit does not match lock for ${entry.pack}`);
    }
  }

  return {
    ok: true,
    checked: checked.map((file) => path.relative(repoRoot, file))
  };
}

function usage() {
  return [
    "Usage: pack-sync <check|diff|update>",
    "",
    "Implemented in v0.1:",
    "  check    Validate portable manifest, overlay, and catalog JSON",
    "",
    "Roadmapped:",
    "  diff     Deterministic upstream pack diff",
    "  update   Update locks/catalogs to a SHA or tag"
  ].join("\n");
}

export async function packSyncMain(argv) {
  const [command] = argv;

  if (command === "check") {
    const result = await checkPackMetadata();
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  if (command === "diff" || command === "update") {
    console.error(`${command} is roadmapped after v0.1 bootstrap. See GitHub issue #4.`);
    return 2;
  }

  console.error(usage());
  return 2;
}

export function runPackSyncCli(argv) {
  packSyncMain(argv)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
