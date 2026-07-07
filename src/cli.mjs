import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildRerankCandidateCards,
  defaultCatalogDir,
  formatResultsText,
  loadCatalog,
  parsePackRoot,
  runVoyageRerank,
  searchCatalog
} from "./search.mjs";
import { runPackSyncCli } from "./pack-sync.mjs";

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

function parseSearchArgs(argv) {
  const [studio, query, ...rest] = argv;
  const options = {
    studio,
    query,
    catalogDir: defaultCatalogDir(),
    format: "text",
    limit: 3,
    engine: "fts",
    packRoots: {},
    rerank: "off"
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];

    if (arg === "--catalog-dir") {
      options.catalogDir = pathToFileURL(path.resolve(optionValue("--catalog-dir", next)));
      index += 1;
    } else if (arg === "--format") {
      options.format = optionValue("--format", next);
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
    } else if (arg === "--rerank") {
      options.rerank = optionValue("--rerank", next);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function searchUsage() {
  return [
    'Usage: debloat-skill-search <studio> "<query>" [--format json|text] [--limit N]',
    "       [--catalog-dir PATH] [--engine fts|json] [--pack-root PACK=PATH] [--rerank off|voyage]",
    "",
    "Default output is top 3 compact results. Rerank is default-off shadow mode and receives candidate cards only."
  ].join("\n");
}

function formatRerankText(rerank) {
  if (!rerank) return "";
  const top = rerank.ranked?.[0];
  const topText = top ? ` top: ${top.name} (${top.relevanceScore ?? "n/a"})` : "";
  const changeText = rerank.status === "completed" && top
    ? rerank.selectedSkillWouldChange
      ? " would-change-top1"
      : " preserves-top1"
    : "";
  return `\n\nrerank: voyage shadow ${rerank.status}${topText}${changeText}`;
}

export async function searchMain(argv) {
  let options;
  try {
    options = parseSearchArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(searchUsage());
    return 2;
  }

  if (!options.studio || !options.query) {
    console.error(searchUsage());
    return 2;
  }

  if (!["text", "json"].includes(options.format)) {
    throw new Error(`Unsupported format: ${options.format}`);
  }

  if (!["fts", "json"].includes(options.engine)) {
    throw new Error(`Unsupported search engine: ${options.engine}`);
  }

  if (!["off", "voyage"].includes(options.rerank)) {
    throw new Error(`Unsupported rerank provider: ${options.rerank}`);
  }

  const catalog = await loadCatalog(options);
  const results = searchCatalog(catalog, options.query, options);
  const rerank =
    options.rerank === "voyage"
      ? await runVoyageRerank({
          query: options.query,
          candidateCards: buildRerankCandidateCards(results)
        })
      : undefined;

  if (options.format === "json") {
    console.log(
      JSON.stringify(
        {
          studio: options.studio,
          query: options.query,
          results,
          ...(rerank ? { rerank } : {})
        },
        null,
        2
      )
    );
  } else {
    console.log(`${formatResultsText(results)}${formatRerankText(rerank)}`);
  }

  return 0;
}

export function runSearchCli(argv) {
  searchMain(argv)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

function mainUsage() {
  return [
    "Usage: agent-skill-debloater <command>",
    "",
    "Commands:",
    "  search <studio> <query>   Search a hidden skill catalog",
    "  pack-sync <command>       Check or update pack metadata",
    "  help                      Show this message"
  ].join("\n");
}

export function runMainCli(argv) {
  const [command, ...rest] = argv;

  if (command === "search") {
    runSearchCli(rest);
    return;
  }

  if (command === "pack-sync") {
    runPackSyncCli(rest);
    return;
  }

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(mainUsage());
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error(mainUsage());
  process.exitCode = 2;
}
