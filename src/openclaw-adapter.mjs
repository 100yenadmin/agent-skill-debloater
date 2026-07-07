import path from "node:path";
import { pathToFileURL } from "node:url";

import { defaultCatalogDir, loadCatalog, searchCatalog } from "./search.mjs";

const ADAPTER_ID = "agent-skill-debloater/openclaw-adapter/v1";
const DEFAULT_LIMIT = 3;
const DEFAULT_ENGINE = "fts";

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

function parsePackRoot(value) {
  const separator = value.indexOf("=");
  if (separator === -1) {
    throw new Error(`--pack-root must be PACK=PATH, received ${value}`);
  }
  return [value.slice(0, separator), value.slice(separator + 1)];
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
    packRoots: {}
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
    "Prints compact JSON candidates plus selectedSkillTrace for OpenClaw adapter smoke tests."
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
