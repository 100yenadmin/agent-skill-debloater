import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const DEFAULT_LIMIT = 3;
const DEFAULT_MIN_SCORE = 40;
const DEFAULT_ENGINE = "fts";
const DEFAULT_CANDIDATE_LIMIT = 40;
const DEFAULT_VOYAGE_RERANK_MODEL = "rerank-2.5-lite";
const DEFAULT_VOYAGE_RERANK_TIMEOUT_MS = 8000;
const VOYAGE_RERANK_ENDPOINT = "https://api.voyageai.com/v1/rerank";
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

function fieldText(entry, field) {
  const value = entry[field];
  return Array.isArray(value) ? value.join(" ") : String(value ?? "");
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

function ftsQuery(queryTokens) {
  return queryTokens
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean)
    .map((token) => `${token}*`)
    .join(" OR ");
}

function loadSqliteDatabaseSync() {
  try {
    return require("node:sqlite").DatabaseSync;
  } catch {
    return null;
  }
}

function isFtsUnavailableError(error) {
  return /no such module: fts5/i.test(String(error?.message ?? ""));
}

export function ftsCandidateIndexes(catalog, queryTokens, { candidateLimit = DEFAULT_CANDIDATE_LIMIT } = {}) {
  const query = ftsQuery(queryTokens);
  if (!query) return [];

  const limit = Number(candidateLimit);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("candidateLimit must be a positive integer");
  }

  const Database = loadSqliteDatabaseSync();
  if (!Database) {
    throw new Error("SQLite FTS5 search is unavailable in this Node runtime");
  }

  const db = new Database(":memory:");
  try {
    try {
      db.exec(`
        CREATE VIRTUAL TABLE skills USING fts5(
          name,
          title,
          aliases,
          tags,
          useWhen,
          description,
          source,
          capabilities,
          tokenize = 'porter unicode61'
        )
      `);
    } catch (error) {
      if (isFtsUnavailableError(error)) {
        throw new Error("SQLite FTS5 search is unavailable in this Node runtime");
      }
      throw error;
    }
    const insert = db.prepare(
      "INSERT INTO skills(rowid, name, title, aliases, tags, useWhen, description, source, capabilities) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    catalog.forEach((entry, index) => {
      insert.run(
        index + 1,
        fieldText(entry, "name"),
        fieldText(entry, "title"),
        fieldText(entry, "aliases"),
        fieldText(entry, "tags"),
        fieldText(entry, "useWhen"),
        fieldText(entry, "description"),
        fieldText(entry, "source"),
        fieldText(entry, "capabilities")
      );
    });

    return db
      .prepare(
        `SELECT rowid
         FROM skills
         WHERE skills MATCH ?
         ORDER BY bm25(skills, 8.0, 7.0, 6.0, 5.0, 3.0, 2.0, 1.0, 0.5)
         LIMIT ?`
      )
      .all(query, limit)
      .map((row) => Number(row.rowid) - 1);
  } finally {
    db.close();
  }
}

function candidateCatalog(catalog, queryTokens, { engine, candidateLimit }) {
  if (engine === "json") return catalog;
  if (engine !== "fts") {
    throw new Error(`Unsupported search engine: ${engine}`);
  }
  const limit = Number(candidateLimit);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("candidateLimit must be a positive integer");
  }

  if (!ftsQuery(queryTokens)) return catalog;

  try {
    const indexes = ftsCandidateIndexes(catalog, queryTokens, { candidateLimit: limit });
    if (indexes.length === 0) return [];
    if (indexes.length >= limit) return catalog;
    return indexes.map((index) => catalog[index]).filter(Boolean);
  } catch {
    return catalog;
  }
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
    engine = DEFAULT_ENGINE,
    candidateLimit = DEFAULT_CANDIDATE_LIMIT,
    packRoots = {}
  } = {}
) {
  const resultLimit = Number(limit);
  if (!Number.isInteger(resultLimit) || resultLimit < 1) {
    throw new Error("limit must be a positive integer");
  }
  const queryTokens = tokenize(query);
  const rawQuery = String(query ?? "").toLowerCase();
  const candidates = candidateCatalog(catalog, queryTokens, { engine, candidateLimit });

  const scored = candidates.map((entry) => {
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
  return sanitizeRerankCandidateCards(results);
}

export function sanitizeRerankCandidateCards(candidateCards) {
  return candidateCards.map((entry) => ({
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

function compactList(values) {
  return Array.isArray(values) ? values.filter((value) => typeof value === "string" && value).join(", ") : "";
}

function compactValue(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 1000);
}

export function formatRerankCandidateDocument(card) {
  return [
    ["name", card.name],
    ["title", card.title],
    ["studio", card.studio],
    ["source", card.source],
    ["description", card.description],
    ["use_when", card.useWhen],
    ["aliases", compactList(card.aliases)],
    ["tags", compactList(card.tags)],
    ["capabilities", compactList(card.capabilities)],
    ["skill_path", card.skillPath],
    ["lexical_confidence", typeof card.confidence === "number" ? card.confidence.toFixed(2) : ""],
    ["lexical_why", compactList(card.why)]
  ]
    .map(([key, value]) => [key, compactValue(value)])
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

export function buildVoyageRerankRequest(
  query,
  candidateCards,
  { model = DEFAULT_VOYAGE_RERANK_MODEL } = {}
) {
  if (!Array.isArray(candidateCards)) {
    throw new Error("candidateCards must be an array");
  }

  return {
    query: String(query ?? ""),
    documents: candidateCards.map(formatRerankCandidateDocument),
    model,
    top_k: candidateCards.length,
    truncation: true
  };
}

function normalizeVoyageRankings(payload, candidateCards) {
  const rows = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.results)
      ? payload.results
      : [];

  return rows
    .map((row, rankIndex) => {
      const index = Number(row?.index);
      if (!Number.isInteger(index) || index < 0 || index >= candidateCards.length) return null;
      const rawScore = row?.relevance_score ?? row?.relevanceScore ?? row?.score;
      const relevanceScore = Number(rawScore);
      const card = candidateCards[index];

      return {
        rank: rankIndex + 1,
        index,
        originalRank: index + 1,
        name: card.name,
        source: card.source,
        skillPath: card.skillPath,
        relevanceScore: Number.isFinite(relevanceScore) ? Number(relevanceScore.toFixed(6)) : null
      };
    })
    .filter(Boolean);
}

function rerankTimeoutMs(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_VOYAGE_RERANK_TIMEOUT_MS;
}

function failedVoyageRerank(base, message) {
  return {
    ...base,
    status: "failed",
    error: compactValue(message).slice(0, 240),
    ranked: [],
    selectedSkillWouldChange: false
  };
}

function invalidVoyageRerank(base) {
  return {
    ...base,
    status: "invalid-response",
    error: "Voyage rerank response did not include any valid ranked candidates",
    ranked: [],
    selectedSkillWouldChange: null
  };
}

export async function runVoyageRerank({
  query,
  candidateCards,
  apiKey = process.env.VOYAGE_API_KEY,
  model = process.env.VOYAGE_RERANK_MODEL || DEFAULT_VOYAGE_RERANK_MODEL,
  fetchImpl = globalThis.fetch,
  timeoutMs = rerankTimeoutMs(process.env.VOYAGE_RERANK_TIMEOUT_MS)
} = {}) {
  const cards = Array.isArray(candidateCards) ? sanitizeRerankCandidateCards(candidateCards) : [];
  const base = {
    provider: "voyage",
    mode: "shadow",
    status: "not-run",
    model,
    inputCount: cards.length,
    candidateCards: cards
  };

  if (cards.length === 0) {
    return {
      ...base,
      status: "skipped-empty-candidates",
      ranked: [],
      selectedSkillWouldChange: false
    };
  }

  if (!apiKey) {
    return {
      ...base,
      status: "skipped-missing-api-key",
      ranked: [],
      selectedSkillWouldChange: false
    };
  }

  if (typeof fetchImpl !== "function") {
    return {
      ...base,
      status: "skipped-missing-fetch",
      ranked: [],
      selectedSkillWouldChange: false
    };
  }

  const request = buildVoyageRerankRequest(query, cards, { model });
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), rerankTimeoutMs(timeoutMs))
    : null;

  try {
    const response = await fetchImpl(VOYAGE_RERANK_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(request),
      signal: controller?.signal
    });

    if (!response?.ok) {
      return failedVoyageRerank(
        base,
        `Voyage rerank request failed with HTTP ${response?.status ?? "unknown"}`
      );
    }

    const payload = await response.json();
    const ranked = normalizeVoyageRankings(payload, cards);
    if (ranked.length === 0) {
      return invalidVoyageRerank(base);
    }
    const top = ranked[0] ?? null;

    return {
      ...base,
      status: "completed",
      ranked,
      selectedSkillWouldChange: Boolean(top && top.index !== 0)
    };
  } catch (error) {
    const message = error?.name === "AbortError"
      ? `Voyage rerank request timed out after ${rerankTimeoutMs(timeoutMs)}ms`
      : error?.message ?? "Voyage rerank request failed";
    return failedVoyageRerank(base, message);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function parsePackRoot(value) {
  const separator = value.indexOf("=");
  if (separator === -1) {
    throw new Error(`--pack-root must be PACK=PATH, received ${value}`);
  }
  const pack = value.slice(0, separator);
  const root = value.slice(separator + 1);
  if (!pack || !root) {
    throw new Error(`--pack-root must be PACK=PATH with non-empty values, received ${value}`);
  }
  return [pack, root];
}

export function parsePackRootsEnv(value = process.env.AGENT_SKILL_DEBLOATER_PACK_ROOTS) {
  if (value === undefined || value === null || value === "") return Object.create(null);

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("AGENT_SKILL_DEBLOATER_PACK_ROOTS must be a JSON object of pack id to root path");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AGENT_SKILL_DEBLOATER_PACK_ROOTS must be a JSON object of pack id to root path");
  }

  const packRoots = Object.create(null);
  for (const [pack, root] of Object.entries(parsed)) {
    if (!pack || typeof pack !== "string") {
      throw new Error("AGENT_SKILL_DEBLOATER_PACK_ROOTS pack ids must be non-empty strings");
    }
    if (!root || typeof root !== "string") {
      throw new Error(`AGENT_SKILL_DEBLOATER_PACK_ROOTS root for ${pack} must be a non-empty string`);
    }
    packRoots[pack] = root;
  }

  return packRoots;
}

export function defaultCatalogDir() {
  return pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../catalogs/"));
}
