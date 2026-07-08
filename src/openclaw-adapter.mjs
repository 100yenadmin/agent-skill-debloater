import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  defaultCatalogDir,
  loadCatalog,
  parsePackReadPath,
  parsePackRoot,
  parsePackRootsEnv,
  searchCatalog
} from "./search.mjs";

const ADAPTER_ID = "agent-skill-debloater/openclaw-adapter/v1";
const CONTRACT_VERSION = "openclaw-adapter-contract/v0";
const DEFAULT_LIMIT = 3;
const DEFAULT_ENGINE = "fts";
const REQUIRED_CANDIDATE_FIELDS = [
  "name",
  "title",
  "studio",
  "source",
  "pack",
  "description",
  "useWhen",
  "capabilities",
  "sourceCommit",
  "sourceUrl",
  "skillPath",
  "readPath",
  "confidence",
  "confidenceLabel",
  "score",
  "why"
];
const REQUIRED_TRACE_FIELDS = [
  "name",
  "title",
  "studio",
  "source",
  "pack",
  "skillPath",
  "readPath",
  "sourceCommit",
  "sourceUrl",
  "capabilities",
  "confidence",
  "confidenceLabel",
  "score",
  "rank",
  "why"
];
const BODY_FIELD_NAMES = new Set(["body", "rawBody", "skillBody", "content", "instructions"]);

function optionValue(name, value) {
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parsePositiveIntegerOption(name, value) {
  const raw = optionValue(name, value);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function compactCandidate(result) {
  return {
    name: result.name,
    title: result.title,
    studio: result.studio,
    source: result.source,
    pack: result.pack,
    description: result.description,
    useWhen: result.useWhen,
    capabilities: result.capabilities,
    sourceCommit: result.sourceCommit,
    sourceUrl: result.sourceUrl,
    skillPath: result.skillPath,
    readPath: result.readPath,
    confidence: result.confidence,
    confidenceLabel: result.confidenceLabel,
    score: result.score,
    why: result.why
  };
}

export function toSelectedSkillTrace(result, { rank = 1 } = {}) {
  if (!result) return null;
  return {
    name: result.name,
    title: result.title,
    studio: result.studio,
    source: result.source,
    pack: result.pack,
    skillPath: result.skillPath,
    readPath: result.readPath,
    sourceCommit: result.sourceCommit,
    sourceUrl: result.sourceUrl,
    capabilities: result.capabilities,
    confidence: result.confidence,
    confidenceLabel: result.confidenceLabel,
    score: result.score,
    rank,
    why: result.why
  };
}

export function toOpenClawAdapterResponse({
  studio,
  query,
  limit = DEFAULT_LIMIT,
  engine = DEFAULT_ENGINE,
  results = []
}) {
  const candidates = results.map(compactCandidate);
  const selectedCandidate = candidates[0]?.confidenceLabel === "high" ? candidates[0] : null;
  return {
    adapter: ADAPTER_ID,
    contractVersion: CONTRACT_VERSION,
    request: {
      studio,
      query,
      limit,
      engine
    },
    candidates,
    selectedSkillTrace: toSelectedSkillTrace(selectedCandidate, { rank: 1 })
  };
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
}

function assertNoBodyFields(value, label) {
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (BODY_FIELD_NAMES.has(key)) {
      throw new Error(`${label} must not include ${key}`);
    }
  }
}

function assertReadPath(value, label, { packRootsSupplied }) {
  assertString(value, label);
  if (value.startsWith("pack://")) {
    parsePackReadPath(value);
    return;
  }
  if (path.isAbsolute(value) || path.win32.isAbsolute(value)) {
    if (!packRootsSupplied) {
      throw new Error(`${label} must use pack:// unless pack roots are supplied`);
    }
    return;
  }
  throw new Error(`${label} must be a pack:// URI or pack-root-resolved absolute path`);
}

function assertCandidate(candidate, index, { packRootsSupplied }) {
  const label = `candidates[${index}]`;
  assertObject(candidate, label);
  assertNoBodyFields(candidate, label);
  for (const field of REQUIRED_CANDIDATE_FIELDS) {
    if (!(field in candidate)) {
      throw new Error(`${label}.${field} is required`);
    }
  }

  for (const field of ["name", "title", "studio", "source", "pack", "description", "useWhen", "sourceCommit", "sourceUrl", "skillPath"]) {
    assertString(candidate[field], `${label}.${field}`);
  }
  assertReadPath(candidate.readPath, `${label}.readPath`, { packRootsSupplied });
  assertStringArray(candidate.capabilities, `${label}.capabilities`);
  assertStringArray(candidate.why, `${label}.why`);
  assertNumber(candidate.confidence, `${label}.confidence`);
  assertNumber(candidate.score, `${label}.score`);
  if (!["high", "ambiguous", "low"].includes(candidate.confidenceLabel)) {
    throw new Error(`${label}.confidenceLabel must be high, ambiguous, or low`);
  }
  const sourceUrl = new URL(candidate.sourceUrl);
  if (!["http:", "https:"].includes(sourceUrl.protocol)) {
    throw new Error(`${label}.sourceUrl must be http(s)`);
  }
}

function assertSelectedTrace(trace, response, { packRootsSupplied }) {
  if (trace === null) {
    const top = response.candidates[0];
    if (top?.confidenceLabel === "high") {
      throw new Error("selectedSkillTrace must be present for high-confidence top candidates");
    }
    return;
  }

  assertObject(trace, "selectedSkillTrace");
  assertNoBodyFields(trace, "selectedSkillTrace");
  for (const field of REQUIRED_TRACE_FIELDS) {
    if (!(field in trace)) {
      throw new Error(`selectedSkillTrace.${field} is required`);
    }
  }
  if ("description" in trace || "useWhen" in trace) {
    throw new Error("selectedSkillTrace must omit candidate prose fields");
  }
  assertReadPath(trace.readPath, "selectedSkillTrace.readPath", { packRootsSupplied });
  assertStringArray(trace.capabilities, "selectedSkillTrace.capabilities");
  assertStringArray(trace.why, "selectedSkillTrace.why");
  assertNumber(trace.confidence, "selectedSkillTrace.confidence");
  assertNumber(trace.score, "selectedSkillTrace.score");
  if (trace.rank !== 1) {
    throw new Error("selectedSkillTrace.rank must be 1");
  }

  const top = response.candidates[0];
  if (!top) {
    throw new Error("selectedSkillTrace requires at least one candidate");
  }
  if (top.confidenceLabel !== "high") {
    throw new Error("selectedSkillTrace must only be present for high-confidence top candidates");
  }
  for (const field of ["name", "studio", "source", "pack", "skillPath", "readPath", "confidenceLabel"]) {
    if (trace[field] !== top[field]) {
      throw new Error(`selectedSkillTrace.${field} must match candidates[0].${field}`);
    }
  }
}

export function assertOpenClawAdapterContract(response, { packRootsSupplied = false } = {}) {
  assertObject(response, "response");
  if (response.adapter !== ADAPTER_ID) {
    throw new Error(`response.adapter must be ${ADAPTER_ID}`);
  }
  if (response.contractVersion !== CONTRACT_VERSION) {
    throw new Error(`response.contractVersion must be ${CONTRACT_VERSION}`);
  }
  assertObject(response.request, "response.request");
  assertString(response.request.studio, "response.request.studio");
  assertString(response.request.query, "response.request.query");
  if (!Number.isInteger(response.request.limit) || response.request.limit < 1) {
    throw new Error("response.request.limit must be a positive integer");
  }
  if (!["fts", "json"].includes(response.request.engine)) {
    throw new Error("response.request.engine must be fts or json");
  }
  if (!Array.isArray(response.candidates)) {
    throw new Error("response.candidates must be an array");
  }
  if (response.candidates.length > response.request.limit) {
    throw new Error("response.candidates must not exceed response.request.limit");
  }
  response.candidates.forEach((candidate, index) => assertCandidate(candidate, index, { packRootsSupplied }));
  assertSelectedTrace(response.selectedSkillTrace, response, { packRootsSupplied });
  return true;
}

export async function searchOpenClawSkillCatalog({
  studio,
  query,
  catalogDir = defaultCatalogDir(),
  limit = DEFAULT_LIMIT,
  engine = DEFAULT_ENGINE,
  candidateLimit,
  packRoots = {}
}) {
  const catalog = await loadCatalog({ studio, catalogDir });
  const results = searchCatalog(catalog, query, {
    limit,
    engine,
    candidateLimit,
    packRoots
  });
  return toOpenClawAdapterResponse({
    studio,
    query,
    limit,
    engine,
    results
  });
}

function parseOpenClawAdapterArgs(argv) {
  const [command, studio, query, ...rest] = argv;
  if (command !== "search") {
    throw new Error(`Unknown OpenClaw adapter command: ${command ?? "<missing>"}`);
  }
  const options = {
    studio,
    query,
    catalogDir: defaultCatalogDir(),
    limit: DEFAULT_LIMIT,
    engine: DEFAULT_ENGINE,
    packRoots: parsePackRootsEnv()
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];

    if (arg === "--catalog-dir") {
      options.catalogDir = pathToFileURL(path.resolve(optionValue("--catalog-dir", next)));
      index += 1;
    } else if (arg === "--limit") {
      options.limit = parsePositiveIntegerOption("--limit", next);
      index += 1;
    } else if (arg === "--engine") {
      options.engine = optionValue("--engine", next);
      index += 1;
    } else if (arg === "--pack-root") {
      const [pack, root] = parsePackRoot(optionValue("--pack-root", next));
      options.packRoots[pack] = root;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function usage() {
  return [
    "Usage: agent-skill-debloater openclaw-adapter search <studio> <query>",
    "       [--catalog-dir PATH] [--limit N] [--engine fts|json] [--pack-root PACK=PATH]",
    "",
    "Prints compact JSON candidates plus selectedSkillTrace for OpenClaw adapter smoke tests.",
    "Pack roots also default from AGENT_SKILL_DEBLOATER_PACK_ROOTS (JSON pack-id to path)."
  ].join("\n");
}

export async function openClawAdapterMain(argv) {
  let options;
  try {
    options = parseOpenClawAdapterArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }

  if (!options.studio || !options.query) {
    console.error(usage());
    return 2;
  }
  if (!["fts", "json"].includes(options.engine)) {
    throw new Error(`Unsupported search engine: ${options.engine}`);
  }

  const response = await searchOpenClawSkillCatalog(options);
  console.log(JSON.stringify(response, null, 2));
  return 0;
}

export function runOpenClawAdapterCli(argv) {
  openClawAdapterMain(argv)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
