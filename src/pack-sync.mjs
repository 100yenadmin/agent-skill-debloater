import { readFile, readdir, writeFile } from "node:fs/promises";
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
const gitShaPattern = /^[a-f0-9]{40}$/;
const isoDatePattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

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

async function writeJsonFile(file, json) {
  await writeFile(file, `${JSON.stringify(json, null, 2)}\n`);
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

function hasRelativeUrlSegment(value) {
  return value.split("/").some((segment) => {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return true;
    }
    return decoded === "." || decoded === ".." || decoded.includes("/");
  });
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
  const expectedPathPrefix = `/${packId}/blob/${resolvedSha}/`;
  const rawTail = value.startsWith(expectedPrefix) ? value.slice(expectedPrefix.length) : "";
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !value.startsWith(expectedPrefix) ||
    !parsed.pathname.startsWith(expectedPathPrefix) ||
    parsed.pathname.length <= expectedPathPrefix.length ||
    rawTail.length === 0 ||
    hasRelativeUrlSegment(rawTail)
  ) {
    throw new Error(`${label} must be under ${expectedPrefix}`);
  }
}

function assertValidLock(packId, lock, { missingShaLabel = `Lock ${packId}` } = {}) {
  assertCanonicalRepoUrl(packId, lock.repoUrl, `Lock ${packId} repoUrl`);
  if (!gitShaPattern.test(lock.resolvedSha ?? "")) {
    throw new Error(`${missingShaLabel} is missing a 40-character resolvedSha`);
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

function addCatalogSkillCoverage(catalogSkillPathsByPack, packId, skillPath) {
  const skillPaths = catalogSkillPathsByPack.get(packId) ?? new Set();
  skillPaths.add(skillPath);
  catalogSkillPathsByPack.set(packId, skillPaths);
}

function sortedSetValues(set) {
  return [...(set ?? new Set())].sort();
}

function assertBlobSha(value, label) {
  if (!gitShaPattern.test(value ?? "")) {
    throw new Error(`${label} must be a 40-character git blob SHA`);
  }
}

function normalizeSkillRecords(skills = [], label = "skills") {
  if (!Array.isArray(skills)) {
    throw new Error(`${label} must be an array`);
  }
  const seen = new Set();
  return skills
    .map((skill, index) => {
      const entryLabel = `${label}[${index}]`;
      assertPortableRelativePath(skill.path, `${entryLabel}.path`);
      if (!skill.path.endsWith("/SKILL.md")) {
        throw new Error(`${entryLabel}.path must end with /SKILL.md`);
      }
      assertBlobSha(skill.blobSha, `${entryLabel}.blobSha`);
      if (seen.has(skill.path)) {
        throw new Error(`${label} contains duplicate path ${skill.path}`);
      }
      seen.add(skill.path);
      return { path: skill.path, blobSha: skill.blobSha };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function assertLockSkillRecords(lock, pack) {
  if (!Array.isArray(lock.skills)) return;
  const seen = new Set();
  for (const [index, skill] of lock.skills.entries()) {
    const label = `Lock ${lock.pack} skills[${index}]`;
    assertPortableRelativePath(skill.path, `${label}.path`);
    if (!skill.path.endsWith("/SKILL.md")) {
      throw new Error(`${label}.path must end with /SKILL.md`);
    }
    assertBlobSha(skill.blobSha, `${label}.blobSha`);
    if (seen.has(skill.path)) {
      throw new Error(`Lock ${lock.pack} skills contains duplicate path ${skill.path}`);
    }
    seen.add(skill.path);
    if (!matchesAllowedPath(skill.path, pack.allowedPaths ?? [])) {
      throw new Error(`${label}.path is outside manifest allowedPaths`);
    }
  }
}

function assertTargetSkillPathsAllowed(skills, pack, label = "target.skills") {
  if (!Array.isArray(skills)) return;
  for (const [index, skill] of skills.entries()) {
    if (!matchesAllowedPath(skill.path, pack.allowedPaths ?? [])) {
      throw new Error(`${label}[${index}].path is outside manifest allowedPaths`);
    }
  }
}

function assertResolvedAt(value) {
  if (!isoDatePattern.test(value ?? "")) {
    throw new Error("resolvedAt must match YYYY-MM-DD");
  }
}

function targetLicense(target) {
  if (!target?.license?.path || !target?.license?.blobSha) {
    throw new Error("target.license requires path and blobSha");
  }
  assertPortableRelativePath(target.license.path, "target.license.path");
  if (target.license.path !== "LICENSE") {
    throw new Error("target.license.path must be LICENSE");
  }
  assertBlobSha(target.license.blobSha, "target.license.blobSha");
  return {
    path: target.license.path,
    blobSha: target.license.blobSha
  };
}

function validateTarget(target) {
  if (!target || typeof target !== "object") {
    throw new Error("target metadata is required");
  }
  if (!target.resolvedRef) {
    throw new Error("target.resolvedRef is required");
  }
  if (!gitShaPattern.test(target.resolvedSha ?? "")) {
    throw new Error("target.resolvedSha must be a 40-character git SHA");
  }
  return {
    resolvedRef: target.resolvedRef,
    resolvedSha: target.resolvedSha,
    license: targetLicense(target),
    skills: normalizeSkillRecords(target.skills, "target.skills")
  };
}

function lockSkillRecords(lock, catalogEntries) {
  if (Array.isArray(lock.skills)) {
    return normalizeSkillRecords(lock.skills, `Lock ${lock.pack} skills`);
  }
  return catalogEntries
    .map((entry) => ({ path: entry.skillPath, blobSha: null, missingHash: true }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function byPath(skills) {
  return new Map(skills.map((skill) => [skill.path, skill]));
}

function byBlob(skills) {
  return skills.reduce((map, skill) => {
    const existing = map.get(skill.blobSha) ?? [];
    existing.push(skill);
    map.set(skill.blobSha, existing);
    return map;
  }, new Map());
}

function diffSkillRecords(currentSkills, targetSkills) {
  const currentByPath = byPath(currentSkills);
  const targetByPath = byPath(targetSkills);
  const bodyChanged = [];
  let unchangedCount = 0;

  for (const current of currentSkills) {
    const target = targetByPath.get(current.path);
    if (!target) continue;
    if (current.missingHash) continue;
    if (current.blobSha === target.blobSha) {
      unchangedCount += 1;
    } else {
      bodyChanged.push({
        path: current.path,
        fromBlobSha: current.blobSha,
        toBlobSha: target.blobSha
      });
    }
  }

  const removedCandidates = currentSkills.filter((skill) => !targetByPath.has(skill.path));
  const addedCandidates = targetSkills.filter((skill) => !currentByPath.has(skill.path));
  const missingCurrentHashes = currentSkills
    .filter((skill) => skill.missingHash && targetByPath.has(skill.path))
    .map((skill) => skill.path)
    .sort();
  const addedByBlob = byBlob(addedCandidates);
  const consumedAdded = new Set();
  const movedOrRenamed = [];
  const removed = [];

  for (const current of removedCandidates) {
    const matches = (addedByBlob.get(current.blobSha) ?? []).filter((skill) => !consumedAdded.has(skill.path));
    if (matches.length === 1) {
      const [target] = matches;
      consumedAdded.add(target.path);
      movedOrRenamed.push({
        from: current.path,
        to: target.path,
        blobSha: current.blobSha
      });
    } else {
      removed.push(current);
    }
  }

  return {
    added: addedCandidates.filter((skill) => !consumedAdded.has(skill.path)).sort((a, b) => a.path.localeCompare(b.path)),
    removed: removed.sort((a, b) => a.path.localeCompare(b.path)),
    movedOrRenamed: movedOrRenamed.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    bodyChanged: bodyChanged.sort((a, b) => a.path.localeCompare(b.path)),
    missingCurrentHashes,
    unchangedCount
  };
}

async function loadPackState({ root = repoRoot, packId }) {
  if (!packId) throw new Error("--pack is required");
  const absoluteRoot = path.resolve(toPath(root));
  const packs = new Map();
  const locks = new Map();
  const catalogRecords = [];

  for (const file of await listJson(absoluteRoot, "packs")) {
    const parsed = await readJsonFile(file);
    await validateArtifactSchema(parsed.json, "packs", { label: toPortableRelative(absoluteRoot, parsed.file) });
    addUnique(packs, parsed.json.id, parsed, "pack id");
  }
  for (const file of await listJson(absoluteRoot, "locks")) {
    const parsed = await readJsonFile(file);
    await validateArtifactSchema(parsed.json, "locks", { label: toPortableRelative(absoluteRoot, parsed.file) });
    addUnique(locks, parsed.json.pack, parsed, "lock pack");
  }
  for (const file of await listJson(absoluteRoot, "catalogs")) {
    const parsed = await readJsonFile(file);
    await validateArtifactSchema(parsed.json, "catalogs", { label: toPortableRelative(absoluteRoot, parsed.file) });
    catalogRecords.push(parsed);
  }

  const packRecord = packs.get(packId);
  if (!packRecord) throw new Error(`Unknown pack ${packId}`);
  const lockRecord = locks.get(packId);
  if (!lockRecord) throw new Error(`Pack ${packId} has no lockfile`);
  assertValidLock(packId, lockRecord.json);
  return {
    root: absoluteRoot,
    packRecord,
    lockRecord,
    catalogRecords,
    catalogEntries: catalogRecords.flatMap((record) => record.json.filter((entry) => entry.pack === packId))
  };
}

export async function diffPackMetadata({ root = repoRoot, packId, target }) {
  const state = await loadPackState({ root, packId });
  const targetState = validateTarget(target);
  assertTargetSkillPathsAllowed(target.skills, state.packRecord.json);
  const currentSkills = lockSkillRecords(state.lockRecord.json, state.catalogEntries);
  const skillChanges = diffSkillRecords(currentSkills, targetState.skills);
  const fromLicenseBlobSha = state.lockRecord.json.license?.blobSha ?? null;
  const license = {
    changed: fromLicenseBlobSha !== targetState.license.blobSha,
    fromBlobSha: fromLicenseBlobSha,
    toBlobSha: targetState.license.blobSha,
    path: targetState.license.path
  };

  return {
    ok: true,
    pack: packId,
    from: {
      resolvedRef: state.lockRecord.json.resolvedRef,
      resolvedSha: state.lockRecord.json.resolvedSha
    },
    to: {
      resolvedRef: targetState.resolvedRef,
      resolvedSha: targetState.resolvedSha
    },
    changes: {
      ...skillChanges,
      license
    }
  };
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function updatePackMetadata({ root = repoRoot, packId, target, resolvedAt = todayIsoDate() }) {
  const state = await loadPackState({ root, packId });
  const targetState = validateTarget(target);
  assertResolvedAt(resolvedAt);
  assertTargetSkillPathsAllowed(target.skills, state.packRecord.json);
  const targetSkillPaths = new Set(targetState.skills.map((skill) => skill.path));
  for (const entry of state.catalogEntries) {
    if (!targetSkillPaths.has(entry.skillPath)) {
      throw new Error(`Cannot update ${packId}: catalog entry ${entry.name} missing target skill ${entry.skillPath}`);
    }
  }

  const lock = {
    ...state.lockRecord.json,
    resolvedRef: targetState.resolvedRef,
    resolvedSha: targetState.resolvedSha,
    resolvedAt,
    license: {
      status: "recorded",
      sourceUrl: `${canonicalRepoUrl(packId)}/blob/${targetState.resolvedSha}/${targetState.license.path}`,
      blobSha: targetState.license.blobSha
    },
    skills: targetState.skills
  };

  await writeJsonFile(state.lockRecord.file, lock);
  for (const record of state.catalogRecords) {
    let changed = false;
    const updated = record.json.map((entry) => {
      if (entry.pack !== packId) return entry;
      changed = true;
      return {
        ...entry,
        sourceCommit: targetState.resolvedSha,
        sourceUrl: `${canonicalRepoUrl(packId)}/blob/${targetState.resolvedSha}/${entry.skillPath}`
      };
    });
    if (changed) {
      await writeJsonFile(record.file, updated);
    }
  }

  return {
    ok: true,
    pack: packId,
    resolvedRef: targetState.resolvedRef,
    resolvedSha: targetState.resolvedSha,
    resolvedAt,
    updated: [
      toPortableRelative(state.root, state.lockRecord.file),
      ...state.catalogRecords
        .filter((record) => record.json.some((entry) => entry.pack === packId))
        .map((record) => toPortableRelative(state.root, record.file))
    ]
  };
}

function optionValue(name, value) {
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parsePackSyncArgs(argv) {
  const [command, ...rest] = argv;
  const options = {
    command,
    root: repoRoot,
    packId: null,
    to: null,
    targetTree: null,
    resolvedAt: todayIsoDate()
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];

    if (arg === "--root") {
      options.root = optionValue("--root", next);
      index += 1;
    } else if (arg === "--pack") {
      options.packId = optionValue("--pack", next);
      index += 1;
    } else if (arg === "--to") {
      options.to = optionValue("--to", next);
      index += 1;
    } else if (arg === "--target-tree") {
      options.targetTree = optionValue("--target-tree", next);
      index += 1;
    } else if (arg === "--resolved-at") {
      options.resolvedAt = optionValue("--resolved-at", next);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function readTargetTree(targetTreePath) {
  const target = JSON.parse(await readFile(targetTreePath, "utf8"));
  return validateTarget(target);
}

async function fetchJson(url) {
  const token = process.env.GITHUB_TOKEN;
  const response = await fetch(url, {
    headers: {
      "accept": "application/vnd.github+json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "user-agent": "agent-skill-debloater"
    }
  });
  if (!response.ok) {
    throw new Error(`GitHub request failed ${response.status}: ${url}`);
  }
  return response.json();
}

function repoPathFromPackId(packId) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(packId ?? "")) {
    throw new Error("--pack must be owner/repo");
  }
  return packId;
}

function allowedTreePaths(tree, allowedPaths) {
  return tree
    .filter((entry) => entry.type === "blob")
    .filter((entry) => entry.path === "LICENSE" || entry.path.endsWith("/SKILL.md"))
    .filter((entry) => entry.path === "LICENSE" || matchesAllowedPath(entry.path, allowedPaths))
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function resolveGitHubTarget({ packRecord, packId, to }) {
  if (!to) {
    throw new Error("--to is required when --target-tree is not provided");
  }
  const repoPath = repoPathFromPackId(packId);
  const ref = encodeURIComponent(to);
  const refData = await fetchJson(`https://api.github.com/repos/${repoPath}/commits/${ref}`);
  const resolvedSha = refData.sha;
  if (!gitShaPattern.test(resolvedSha ?? "")) {
    throw new Error(`GitHub ref ${to} did not resolve to a commit SHA`);
  }
  const treeSha = refData.commit?.tree?.sha;
  if (!treeSha) {
    throw new Error(`GitHub ref ${to} did not include a tree SHA`);
  }
  const treeData = await fetchJson(`https://api.github.com/repos/${repoPath}/git/trees/${treeSha}?recursive=1`);
  if (treeData.truncated) {
    throw new Error(`GitHub tree for ${packId}@${to} is truncated; refusing partial update`);
  }
  const tree = allowedTreePaths(treeData.tree ?? [], packRecord.json.allowedPaths ?? []);
  const license = tree.find((entry) => entry.path === "LICENSE");
  if (!license) {
    throw new Error(`GitHub tree for ${packId}@${to} does not contain LICENSE`);
  }

  return validateTarget({
    resolvedRef: to,
    resolvedSha,
    license: {
      path: license.path,
      blobSha: license.sha
    },
    skills: tree
      .filter((entry) => entry.path.endsWith("/SKILL.md"))
      .map((entry) => ({ path: entry.path, blobSha: entry.sha }))
  });
}

async function resolveTarget({ root, packId, to, targetTree }) {
  if (targetTree) {
    return readTargetTree(targetTree);
  }
  const state = await loadPackState({ root, packId });
  return resolveGitHubTarget({ packRecord: state.packRecord, packId, to });
}

export async function checkPackMetadata({ root = repoRoot } = {}) {
  const absoluteRoot = path.resolve(toPath(root));
  const checked = [];
  const packs = new Map();
  const locks = new Map();
  const catalogs = [];
  const catalogFiles = new Set();
  const catalogFilesByPack = new Map();
  const catalogSkillPathsByPack = new Map();
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
        if (!Array.isArray(studio.packs) || studio.packs.length === 0) {
          throw new Error(`Overlay studio ${studioId} is active but has no packs`);
        }
        if (!Number.isInteger(studio.defaultLimit) || studio.defaultLimit < 1) {
          throw new Error(`Overlay studio ${studioId} is active but missing a positive defaultLimit`);
        }
      }
      for (const packId of studio.packs ?? []) {
        if (!packs.has(packId)) {
          throw new Error(`Overlay studio ${studioId} references undeclared pack ${packId}`);
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
    if (lock) {
      assertValidLock(packId, lock, { missingShaLabel: `Pack ${packId} lockfile` });
    }
    if (lock && stripTrailingSlash(pack.repoUrl) !== stripTrailingSlash(lock.repoUrl)) {
      throw new Error(`Pack ${packId} repoUrl does not match lock repoUrl`);
    }
  }

  for (const [packId, lockRecord] of locks) {
    const lock = lockRecord.json;
    const packRecord = packs.get(packId);
    if (!packRecord) {
      throw new Error(`Lockfile references undeclared pack ${packId}`);
    }
    assertValidLock(packId, lock);
    assertLockSkillRecords(lock, packRecord.json);
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
    addCatalogSkillCoverage(catalogSkillPathsByPack, entry.pack, entry.skillPath);
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
    if (Array.isArray(lockRecord.json.skills)) {
      const lockedSkillPaths = new Set(lockRecord.json.skills.map((skill) => skill.path));
      for (const skillPath of sortedSetValues(catalogSkillPathsByPack.get(packId))) {
        if (!lockedSkillPaths.has(skillPath)) {
          throw new Error(`Lock ${packId} skills is missing catalog skillPath ${skillPath}`);
        }
      }
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
    "Commands:",
    "  check    Validate schemas, portability, provenance, overlays, locks, and catalogs",
    "  diff     Print deterministic upstream pack diff JSON",
    "  update   Update lock and catalog provenance to a target tree/ref",
    "",
    "Options:",
    "  --root PATH                 Repository root (defaults to current package root)",
    "  --pack owner/repo           Pack id to diff/update",
    "  --to sha-or-tag             Resolve target from GitHub",
    "  --target-tree PATH          Read deterministic target metadata JSON instead of GitHub",
    "  --resolved-at YYYY-MM-DD    Override update resolvedAt date"
  ].join("\n");
}

export async function packSyncMain(argv) {
  let options;
  try {
    options = parsePackSyncArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }
  const { command } = options;

  if (command === "check") {
    const result = await checkPackMetadata({ root: options.root });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  if (command === "diff") {
    const target = await resolveTarget(options);
    const report = await diffPackMetadata({ root: options.root, packId: options.packId, target });
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  if (command === "update") {
    const target = await resolveTarget(options);
    const result = await updatePackMetadata({
      root: options.root,
      packId: options.packId,
      target,
      resolvedAt: options.resolvedAt
    });
    const check = await checkPackMetadata({ root: options.root });
    console.log(JSON.stringify({ ...result, check }, null, 2));
    return 0;
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
