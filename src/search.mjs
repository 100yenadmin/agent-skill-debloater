import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_LIMIT = 3;
const DEFAULT_MIN_SCORE = 40;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "for",
  "from",
  "how",
  "i",
  "in",
  "into",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "skill",
  "strategy",
  "the",
  "this",
  "to",
  "we",
  "with"
]);

const REQUIRED_FIELDS = [
  "name",
  "title",
  "studio",
  "source",
  "pack",
  "sourceCommit",
  "sourceUrl",
  "skillPath",
  "description"
];
const STRING_FIELDS = [...REQUIRED_FIELDS, "useWhen"];
const ARRAY_FIELDS = ["aliases", "tags", "capabilities"];

function toPath(input) {
  if (input instanceof URL) return fileURLToPath(input);
  if (typeof input !== "string") {
    throw new TypeError("catalogDir must be a string path or file URL");
  }
  if (input.startsWith("file:")) return fileURLToPath(input);
  return input;
}

function normalizeToken(token) {
  return token
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/ies$/, "y")
    .replace(/s$/, "");
}

function stemToken(token) {
  return token
    .replace(/ing$/, "")
    .replace(/ed$/, "")
    .replace(/e$/, "");
}

function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeToken)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function tokenMatches(tokens, queryToken) {
  const queryStem = stemToken(queryToken);
  return tokens.some((token) => {
    const tokenStem = stemToken(token);
    return (
      token === queryToken ||
      token.startsWith(queryToken) ||
      (queryStem.length > 3 && tokenStem === queryStem)
    );
  });
}

function fieldTokens(entry) {
  return {
    name: tokenize(entry.name),
    title: tokenize(entry.title),
    source: tokenize(entry.source),
    description: tokenize(entry.description),
    useWhen: tokenize(entry.useWhen),
    aliases: (entry.aliases ?? []).flatMap(tokenize),
    tags: (entry.tags ?? []).flatMap(tokenize),
    capabilities: (entry.capabilities ?? []).flatMap(tokenize)
  };
}

function assertPortableSkillPath(entry) {
  const skillPath = entry.skillPath;
  if (typeof skillPath !== "string") {
    throw new Error(`Catalog entry ${entry.name} skillPath must be a string`);
  }
  if (path.isAbsolute(skillPath) || path.win32.isAbsolute(skillPath)) {
    throw new Error(`Catalog entry ${entry.name} has an absolute skillPath`);
  }
  if (skillPath.includes("\\")) {
    throw new Error(`Catalog entry ${entry.name} skillPath must use POSIX separators`);
  }
  const normalized = path.posix.normalize(skillPath);
  if (normalized !== skillPath || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Catalog entry ${entry.name} skillPath must stay inside the pack root`);
  }
  if (!skillPath.endsWith("/SKILL.md")) {
    throw new Error(`Catalog entry ${entry.name} skillPath must end in /SKILL.md`);
  }
}

function assertEntryTypes(entry) {
  for (const field of STRING_FIELDS) {
    if (typeof entry[field] !== "string") {
      throw new Error(`Catalog entry ${entry.name ?? "<unknown>"} ${field} must be a string`);
    }
  }
  for (const field of ARRAY_FIELDS) {
    if (!Array.isArray(entry[field])) {
      throw new Error(`Catalog entry ${entry.name} ${field} must be an array`);
    }
    if (!entry[field].every((value) => typeof value === "string")) {
      throw new Error(`Catalog entry ${entry.name} ${field} must contain only strings`);
    }
  }
}

function normalizeEntry(entry, studio) {
  const normalized = {
    aliases: [],
    tags: [],
    capabilities: ["read-only"],
    useWhen: "",
    ...entry
  };

  for (const field of REQUIRED_FIELDS) {
    if (!normalized[field]) {
      throw new Error(`Catalog entry missing ${field}: ${JSON.stringify(entry)}`);
    }
  }

  assertEntryTypes(normalized);

  if (normalized.studio !== studio) {
    throw new Error(`Catalog entry ${normalized.name} belongs to ${normalized.studio}, not ${studio}`);
  }

  assertPortableSkillPath(normalized);
  return normalized;
}

export async function loadCatalog({
  studio,
  catalogDir = new URL("../catalogs/", import.meta.url)
}) {
  if (!studio) throw new Error("studio is required");

  const catalogPath = path.join(toPath(catalogDir), `${studio}.json`);
  const raw = await readFile(catalogPath, "utf8");
  const entries = JSON.parse(raw);

  if (!Array.isArray(entries)) {
    throw new Error(`Catalog ${catalogPath} must be a JSON array`);
  }

  return entries.map((entry) => normalizeEntry(entry, studio));
}

function ownPackRoot(packRoots, key) {
  if (!packRoots || typeof packRoots !== "object") return undefined;
  if (!Object.hasOwn(packRoots, key)) return undefined;
  const root = packRoots[key];
  if (root === undefined || root === null || root === "") return undefined;
  if (typeof root !== "string") {
    throw new Error(`Pack root for ${key} must be a string`);
  }
  return root;
}

export function packReadPath(pack, skillPath) {
  return `pack://${encodeURIComponent(pack)}/${skillPath}`;
}

export function parsePackReadPath(readPath) {
  const parsed = new URL(readPath);
  if (parsed.protocol !== "pack:") {
    throw new Error(`Expected pack: read path, received ${readPath}`);
  }
  const pack = decodeURIComponent(parsed.host);
  const skillPath = parsed.pathname.replace(/^\//, "");
  if (!pack || !skillPath) {
    throw new Error(`Invalid pack read path: ${readPath}`);
  }
  return { pack, skillPath };
}

function resolveReadPath(entry, packRoots = {}) {
  const root = ownPackRoot(packRoots, entry.pack) ?? ownPackRoot(packRoots, entry.source);
  if (root) return path.join(root, entry.skillPath);
  return packReadPath(entry.pack, entry.skillPath);
}

function scoreEntry(entry, queryTokens, rawQuery) {
  const tokens = fieldTokens(entry);
  const why = [];
  let score = 0;

  const weightedFields = [
    ["name", 14],
    ["title", 12],
    ["aliases", 12],
    ["tags", 9],
    ["useWhen", 6],
    ["description", 4],
    ["source", 2],
    ["capabilities", 1]
  ];

  for (const token of queryTokens) {
    for (const [field, weight] of weightedFields) {
      if (tokenMatches(tokens[field], token)) {
        score += weight;
        why.push(`${field}:${token}`);
      }
    }
  }

  for (const alias of entry.aliases ?? []) {
    const phrase = String(alias).toLowerCase();
    if (phrase && rawQuery.includes(phrase)) {
      score += 16;
      why.push(`phrase:${alias}`);
    }
  }

  for (const tag of entry.tags ?? []) {
    const phrase = String(tag).toLowerCase();
    if (phrase.length > 2 && rawQuery.includes(phrase)) {
      score += 4;
      why.push(`tag-phrase:${tag}`);
    }
  }

  if (rawQuery.includes(String(entry.name).toLowerCase())) {
    score += 40;
    why.push(`exact:${entry.name}`);
  }

  return { score, why: [...new Set(why)].slice(0, 10) };
}

function confidenceFor(score, topScore) {
  if (score <= 0) return 0;
  const absolute = Math.min(0.99, score / 70);
  const relative = topScore > 0 ? Math.min(1, score / topScore) : 0;
  return Number(((absolute * 0.75) + (relative * 0.24)).toFixed(2));
}

export function searchCatalog(
  catalog,
  query,
  {
    limit = DEFAULT_LIMIT,
    minScore = DEFAULT_MIN_SCORE,
    minResultScore = Math.ceil(Number(minScore) / 2),
    packRoots = {}
  } = {}
) {
  const resultLimit = Number(limit);
  if (!Number.isInteger(resultLimit) || resultLimit < 1) {
    throw new Error("limit must be a positive integer");
  }
  const queryTokens = tokenize(query);
  const rawQuery = String(query ?? "").toLowerCase();

  const scored = catalog.map((entry) => {
    const { score, why } = scoreEntry(entry, queryTokens, rawQuery);
    return { entry, score, why };
  }).filter((item) => item.score > 0);

  const topScore = Math.max(0, ...scored.map((item) => item.score));
  if (topScore < minScore) return [];

  const resultScoreFloor = Math.max(1, Number(minResultScore) || 1);
  const sorted = scored
    .filter((item) => item.score >= resultScoreFloor)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));

  return sorted
    .slice(0, resultLimit)
    .map(({ entry, score, why }, index) => {
      const confidence = confidenceFor(score, topScore);
      const margin = index === 0 && sorted.length > 1 ? topScore - sorted[1].score : null;
      return {
        name: entry.name,
        title: entry.title,
        studio: entry.studio,
        source: entry.source,
        pack: entry.pack,
        description: entry.description,
        useWhen: entry.useWhen,
        aliases: entry.aliases,
        tags: entry.tags,
        capabilities: entry.capabilities,
        sourceCommit: entry.sourceCommit,
        sourceUrl: entry.sourceUrl,
        skillPath: entry.skillPath,
        readPath: resolveReadPath(entry, packRoots),
        score,
        confidence,
        confidenceLabel: index === 0 && confidence >= 0.7 && (margin === null || margin >= 8) ? "high" : "ambiguous",
        why
      };
    });
}

export function formatResultsText(results) {
  if (!results.length) {
    return "No clear matching skills found.";
  }

  return results
    .map((entry, index) => {
      const why = entry.why.length ? `\n   why: ${entry.why.join(", ")}` : "";
      return [
        `${index + 1}. ${entry.name} (${entry.source})`,
        `   ${entry.description}`,
        `   confidence: ${entry.confidence.toFixed(2)} (${entry.confidenceLabel})`,
        `   capabilities: ${entry.capabilities.join(", ")}`,
        `   read: ${entry.readPath}${why}`
      ].join("\n");
    })
    .join("\n\n");
}

export function buildRerankCandidateCards(results) {
  return results.map((entry) => ({
    name: entry.name,
    title: entry.title,
    studio: entry.studio,
    source: entry.source,
    description: entry.description,
    useWhen: entry.useWhen,
    aliases: entry.aliases,
    tags: entry.tags,
    capabilities: entry.capabilities,
    sourceCommit: entry.sourceCommit,
    sourceUrl: entry.sourceUrl,
    skillPath: entry.skillPath,
    confidence: entry.confidence,
    why: entry.why
  }));
}

export function parsePackRoot(value) {
  const separator = value.indexOf("=");
  if (separator === -1) {
    throw new Error(`--pack-root must be PACK=PATH, received ${value}`);
  }
  return [value.slice(0, separator), value.slice(separator + 1)];
}

export function defaultCatalogDir() {
  return pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../catalogs/"));
}
