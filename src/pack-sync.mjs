import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertHttpUrl,
  assertNoMachineLocalPaths,
  assertPortableRelativePath
} from "./portable-paths.mjs";
import { validateArtifactSchema } from "./schema-validation.mjs";

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

function toPortableRelative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
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

function canonicalRepoUrl(packId) {
  return `https://github.com/${packId}`;
}

function assertCanonicalRepoUrl(packId, repoUrl, label) {
  assertHttpUrl(repoUrl, label);
  const parsed = new URL(repoUrl);
  const pathname = parsed.pathname.replace(/\/+$/, "");
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    pathname !== `/${packId}`
  ) {
    throw new Error(`${label} must be ${canonicalRepoUrl(packId)}`);
  }
  return canonicalRepoUrl(packId);
}

function assertLockedBlobUrl(value, packId, resolvedSha, label) {
  assertHttpUrl(value, label);
  const parsed = new URL(value);
  const expectedPrefix = `${canonicalRepoUrl(packId)}/blob/${resolvedSha}/`;
  if (parsed.search || parsed.hash || !value.startsWith(expectedPrefix) || value.length <= expectedPrefix.length) {
    throw new Error(`${label} must be under ${expectedPrefix}`);
  }
}

function assertManifestPathPattern(pattern, label) {
  assertPortableRelativePath(pattern, label, { allowGlob: true });
}

function assertStudioId(studioId) {
  if (!/^[a-z][a-z0-9-]*$/.test(studioId)) {
    throw new Error(`Overlay studio id ${studioId} must be lowercase kebab-case`);
  }
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
  const canonicalPackRepoUrl = assertCanonicalRepoUrl(pack.id, pack.repoUrl, `Pack ${pack.id} repoUrl`);
  assertCanonicalRepoUrl(lock.pack, lock.repoUrl, `Lock ${lock.pack} repoUrl`);

  if (entry.source !== entry.pack) {
    throw new Error(`${label} source must match pack ${entry.pack}`);
  }
  if (stripTrailingSlash(pack.repoUrl) !== stripTrailingSlash(lock.repoUrl)) {
    throw new Error(`Pack ${pack.id} repoUrl does not match lock repoUrl`);
  }
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
  const expectedSourceUrl = `${canonicalPackRepoUrl}/blob/${lock.resolvedSha}/${entry.skillPath}`;
  if (entry.sourceUrl !== expectedSourceUrl) {
    throw new Error(`${label} sourceUrl must be ${expectedSourceUrl}`);
  }
}

function addCatalogCoverage(catalogFilesByPack, packId, catalogPath) {
  const files = catalogFilesByPack.get(packId) ?? new Set();
  files.add(catalogPath);
  catalogFilesByPack.set(packId, files);
}

function sortedSetValues(set) {
  return [...(set ?? new Set())].sort();
}

export async function checkPackMetadata({ root = repoRoot } = {}) {
  const absoluteRoot = path.resolve(toPath(root));
  const checked = [];
  const packs = new Map();
  const locks = new Map();
  const catalogs = [];
  const catalogFiles = new Set();
  const catalogFilesByPack = new Map();
  const overlays = [];

  for (const dir of jsonDirs) {
    for (const file of await listJson(absoluteRoot, dir)) {
      const parsed = await readJsonFile(file);
      const relativeFile = toPortableRelative(absoluteRoot, parsed.file);
      await validateArtifactSchema(parsed.json, dir, { label: relativeFile });
      checked.push(parsed.file);

      if (dir === "packs") {
        addUnique(packs, parsed.json.id, parsed, "pack id");
      }
      if (dir === "locks") {
        addUnique(locks, parsed.json.pack, parsed, "lock pack");
      }
      if (dir === "overlays") {
        overlays.push(parsed);
      }
      if (dir === "catalogs") {
        catalogFiles.add(relativeFile);
        const studioFromFile = path.basename(parsed.file, ".json");
        catalogs.push(...parsed.json.map((entry) => ({ entry, file: parsed.file, studioFromFile })));
      }
    }
  }

  const overlayStudios = new Map();
  for (const overlayRecord of overlays) {
    for (const [studioId, studio] of Object.entries(overlayRecord.json.studios ?? {})) {
      assertStudioId(studioId);
      if (overlayStudios.has(studioId)) {
        throw new Error(`Duplicate overlay studio ${studioId}`);
      }
      if (studio.status !== "deferred") {
        if (!studio.visibleRouterSkill) {
          throw new Error(`Overlay studio ${studioId} is active but missing visibleRouterSkill`);
        }
        if (!Number.isInteger(studio.defaultLimit) || studio.defaultLimit < 1) {
          throw new Error(`Overlay studio ${studioId} is active but missing a positive defaultLimit`);
        }
      }
      if (studio.status !== "deferred") {
        for (const packId of studio.packs ?? []) {
          if (!packs.has(packId)) {
            throw new Error(`Overlay studio ${studioId} references undeclared pack ${packId}`);
          }
        }
      }
      overlayStudios.set(studioId, studio);
    }
  }

  for (const [packId, packRecord] of packs) {
    const pack = packRecord.json;
    assertCanonicalRepoUrl(packId, pack.repoUrl, `Pack ${packId} repoUrl`);
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
    if (lock) {
      assertCanonicalRepoUrl(packId, lock.repoUrl, `Lock ${packId} repoUrl`);
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
    assertCanonicalRepoUrl(packId, lock.repoUrl, `Lock ${packId} repoUrl`);
    if (!/^[a-f0-9]{40}$/.test(lock.resolvedSha ?? "")) {
      throw new Error(`Lock ${packId} is missing a 40-character resolvedSha`);
    }
    for (const catalogPath of lock.catalogs ?? []) {
      assertPortableRelativePath(catalogPath, `Lock ${packId} catalogs entry`);
      if (!catalogFiles.has(catalogPath)) {
        throw new Error(`Lock ${packId} references missing catalog ${catalogPath}`);
      }
    }
    if (lock.license?.sourceUrl) {
      assertLockedBlobUrl(lock.license.sourceUrl, packId, lock.resolvedSha, `Lock ${packId} license.sourceUrl`);
    }
  }

  for (const { entry, file, studioFromFile } of catalogs) {
    const relativeFile = toPortableRelative(absoluteRoot, file);
    if (entry.studio !== studioFromFile) {
      throw new Error(`Catalog ${relativeFile} contains ${entry.name} for studio ${entry.studio}`);
    }
    const studio = overlayStudios.get(entry.studio);
    if (!studio) {
      throw new Error(`Catalog entry ${entry.name} references undeclared studio ${entry.studio}`);
    }
    if (!studio.packs.includes(entry.pack)) {
      throw new Error(`Catalog entry ${entry.name} pack ${entry.pack} is not declared for studio ${entry.studio}`);
    }
    addCatalogCoverage(catalogFilesByPack, entry.pack, relativeFile);
    const packRecord = packs.get(entry.pack);
    if (!packRecord) {
      throw new Error(`Catalog entry ${entry.name} references undeclared pack ${entry.pack}`);
    }
    const lockRecord = locks.get(entry.pack);
    if (!lockRecord) throw new Error(`Catalog entry ${entry.name} references unlocked pack ${entry.pack}`);
    assertCatalogEntryProvenance(entry, packRecord, lockRecord);
  }

  for (const [packId, lockRecord] of locks) {
    const expected = sortedSetValues(new Set(lockRecord.json.catalogs ?? []));
    const actual = sortedSetValues(catalogFilesByPack.get(packId));
    if (expected.join("\n") !== actual.join("\n")) {
      throw new Error(
        `Lock ${packId} catalogs do not match catalog coverage: expected ${expected.join(", ") || "<none>"}; actual ${actual.join(", ") || "<none>"}`
      );
    }
  }

  for (const [studioId, studio] of overlayStudios) {
    if (studio.status === "deferred") continue;
    if (!catalogFiles.has(`catalogs/${studioId}.json`)) {
      throw new Error(`Overlay studio ${studioId} is active but has no catalogs/${studioId}.json`);
    }
  }

  return {
    ok: true,
    checked: checked.map((file) => toPortableRelative(absoluteRoot, file))
  };
}

function usage() {
  return [
    "Usage: pack-sync <check|diff|update>",
    "",
    "Implemented in v0.1:",
    "  check    Validate schemas, portability, provenance, overlays, locks, and catalogs",
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
