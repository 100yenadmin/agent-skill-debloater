import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertHttpUrl,
  assertNoMachineLocalPaths,
  assertPortableRelativePath
} from "./portable-paths.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsonDirs = ["packs", "locks", "overlays", "catalogs"];

function toPath(input) {
  if (input instanceof URL) return fileURLToPath(input);
  if (typeof input !== "string") {
    throw new TypeError("root must be a string path or file URL");
  }
  if (input.startsWith("file:")) return fileURLToPath(input);
  return input;
}

async function readJsonFile(file) {
  const body = await readFile(file, "utf8");
  assertNoMachineLocalPaths(body, file);
  return { file, json: JSON.parse(body) };
}

async function listJson(root, dir) {
  const absolute = path.join(root, dir);
  const entries = await readdir(absolute, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => path.join(absolute, entry.name));
}

function addUnique(map, key, value, kind) {
  if (!key) throw new Error(`${kind} is missing an id`);
  if (map.has(key)) {
    const existing = map.get(key);
    throw new Error(`Duplicate ${kind} ${key}: ${existing.file} and ${value.file}`);
  }
  map.set(key, value);
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function assertManifestPathPattern(pattern, label) {
  assertPortableRelativePath(pattern, label, { allowGlob: true });
}

function globToRegExp(pattern) {
  const placeholder = "\u0000";
  const escaped = pattern
    .replace(/\*\*/g, placeholder)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replaceAll(placeholder, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesAllowedPath(skillPath, allowedPaths = []) {
  return allowedPaths.some((pattern) => globToRegExp(pattern).test(skillPath));
}

function assertCatalogEntryProvenance(entry, packRecord, lockRecord) {
  const { json: pack } = packRecord;
  const { json: lock } = lockRecord;
  const label = `Catalog entry ${entry.name}`;

  if (entry.source !== entry.pack) {
    throw new Error(`${label} source must match pack ${entry.pack}`);
  }
  if (stripTrailingSlash(pack.repoUrl) !== stripTrailingSlash(lock.repoUrl)) {
    throw new Error(`Pack ${pack.id} repoUrl does not match lock repoUrl`);
  }
  assertHttpUrl(pack.repoUrl, `Pack ${pack.id} repoUrl`);
  assertHttpUrl(lock.repoUrl, `Lock ${lock.pack} repoUrl`);
  assertPortableRelativePath(entry.skillPath, `${label} skillPath`);
  for (const pattern of pack.allowedPaths ?? []) {
    assertManifestPathPattern(pattern, `Pack ${pack.id} allowedPaths entry`);
  }
  if (!matchesAllowedPath(entry.skillPath, pack.allowedPaths ?? [])) {
    throw new Error(`${label} skillPath is outside manifest allowedPaths`);
  }
  if (entry.sourceCommit !== lock.resolvedSha) {
    throw new Error(`${label} sourceCommit does not match lock for ${entry.pack}`);
  }
  assertHttpUrl(entry.sourceUrl, `${label} sourceUrl`);
  const expectedSourceUrl = `${stripTrailingSlash(lock.repoUrl)}/blob/${lock.resolvedSha}/${entry.skillPath}`;
  if (entry.sourceUrl !== expectedSourceUrl) {
    throw new Error(`${label} sourceUrl must be ${expectedSourceUrl}`);
  }
}

export async function checkPackMetadata({ root = repoRoot } = {}) {
  const absoluteRoot = path.resolve(toPath(root));
  const checked = [];
  const packs = new Map();
  const locks = new Map();
  const catalogs = [];

  for (const dir of jsonDirs) {
    for (const file of await listJson(absoluteRoot, dir)) {
      const parsed = await readJsonFile(file);
      checked.push(parsed.file);

      if (dir === "packs") {
        if (!Array.isArray(parsed.json.allowedPaths)) {
          throw new Error(`Pack ${parsed.json.id} allowedPaths must be an array`);
        }
        addUnique(packs, parsed.json.id, parsed, "pack id");
      }
      if (dir === "locks") {
        addUnique(locks, parsed.json.pack, parsed, "lock pack");
      }
      if (dir === "catalogs") {
        if (!Array.isArray(parsed.json)) {
          throw new Error(`Catalog ${path.relative(absoluteRoot, parsed.file)} must be a JSON array`);
        }
        catalogs.push(...parsed.json.map((entry) => ({ entry, file: parsed.file })));
      }
    }
  }

  for (const [packId, packRecord] of packs) {
    const pack = packRecord.json;
    assertHttpUrl(pack.repoUrl, `Pack ${packId} repoUrl`);
    for (const pattern of pack.allowedPaths) {
      assertManifestPathPattern(pattern, `Pack ${packId} allowedPaths entry`);
    }

    const lockRecord = locks.get(packId);
    const lock = lockRecord?.json;
    if (pack.pinPolicy === "sha" && !lockRecord) {
      throw new Error(`Pack ${packId} uses pinPolicy=sha but has no lockfile`);
    }
    if (lock && !/^[a-f0-9]{40}$/.test(lock.resolvedSha ?? "")) {
      throw new Error(`Pack ${packId} lockfile is missing a 40-character resolvedSha`);
    }
    if (lock && stripTrailingSlash(pack.repoUrl) !== stripTrailingSlash(lock.repoUrl)) {
      throw new Error(`Pack ${packId} repoUrl does not match lock repoUrl`);
    }
  }

  for (const [packId, lockRecord] of locks) {
    const lock = lockRecord.json;
    if (!packs.has(packId)) {
      throw new Error(`Lockfile references undeclared pack ${packId}`);
    }
    assertHttpUrl(lock.repoUrl, `Lock ${packId} repoUrl`);
    if (!/^[a-f0-9]{40}$/.test(lock.resolvedSha ?? "")) {
      throw new Error(`Lock ${packId} is missing a 40-character resolvedSha`);
    }
    for (const catalogPath of lock.catalogs ?? []) {
      assertPortableRelativePath(catalogPath, `Lock ${packId} catalogs entry`);
    }
    if (lock.license?.sourceUrl) {
      assertHttpUrl(lock.license.sourceUrl, `Lock ${packId} license.sourceUrl`);
    }
  }

  for (const { entry } of catalogs) {
    const packRecord = packs.get(entry.pack);
    if (!packRecord) {
      throw new Error(`Catalog entry ${entry.name} references undeclared pack ${entry.pack}`);
    }
    const lockRecord = locks.get(entry.pack);
    if (!lockRecord) throw new Error(`Catalog entry ${entry.name} references unlocked pack ${entry.pack}`);
    assertCatalogEntryProvenance(entry, packRecord, lockRecord);
  }

  return {
    ok: true,
    checked: checked.map((file) => path.relative(absoluteRoot, file))
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
