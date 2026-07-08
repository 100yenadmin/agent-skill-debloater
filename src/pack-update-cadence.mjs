import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const PACK_UPDATE_SUITE = "pack-update-cadence/v0";
export const SEED_PACKS = [
  "jimliu/baoyu-skills",
  "coreyhaines31/marketingskills",
  "garrytan/gstack",
  "obra/superpowers",
  "mattpocock/skills"
];
export const PACK_UPDATE_VALIDATION_COMMANDS = [
  "node bin/pack-sync check",
  "npm run eval:routing",
  "npm run eval:rerank",
  "npm run release:check",
  "npm run pack:dry-run"
];
export const PACK_UPDATE_PROOF_BOUNDARY =
  "Pack update cadence proves reviewed lock/catalog provenance changes only; it does not make new upstream skills router-visible, promote reranking, publish npm packages, mutate OpenClaw core, install customer defaults, or prove customer VM/fleet readiness.";

const CHANGE_TYPES = [
  ["added", "Added upstream skills"],
  ["removed", "Removed upstream skills"],
  ["movedOrRenamed", "Moved or renamed upstream skills"],
  ["bodyChanged", "Body-changed upstream skills"],
  ["missingCurrentHashes", "Current lock skills missing blob hashes"]
];

function assertDiffReport(diffReport) {
  if (!diffReport || typeof diffReport !== "object") {
    throw new Error("diff report must be an object");
  }
  if (diffReport.ok !== true) {
    throw new Error("diff report must have ok=true");
  }
  if (typeof diffReport.pack !== "string" || !diffReport.pack) {
    throw new Error("diff report must include pack");
  }
  for (const section of ["from", "to", "changes"]) {
    if (!diffReport[section] || typeof diffReport[section] !== "object") {
      throw new Error(`diff report must include ${section}`);
    }
  }
}

function count(values) {
  return Array.isArray(values) ? values.length : 0;
}

function sortedStrings(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function changePaths(changeType, values) {
  if (!Array.isArray(values)) return [];
  if (changeType === "movedOrRenamed") {
    return sortedStrings(values.map((value) => `${value.from} -> ${value.to}`));
  }
  if (changeType === "bodyChanged") {
    return sortedStrings(values.map((value) => value.path));
  }
  if (changeType === "missingCurrentHashes") {
    return sortedStrings(values);
  }
  return sortedStrings(values.map((value) => value.path));
}

function changedFiles(updateResult) {
  return Array.isArray(updateResult?.updated) ? sortedStrings(updateResult.updated) : [];
}

function hasAnySkillChange(changes) {
  return CHANGE_TYPES.some(([key]) => count(changes[key]) > 0);
}

function reviewGates(diffReport) {
  const gates = ["routing-eval-required", "pack-sync-check-required"];
  const changes = diffReport.changes ?? {};
  if (count(changes.added) > 0) gates.push("catalog-review-for-new-skills");
  if (count(changes.removed) > 0) gates.push("removed-skill-review");
  if (count(changes.movedOrRenamed) > 0) gates.push("move-rename-review");
  if (count(changes.bodyChanged) > 0) gates.push("body-change-review");
  if (count(changes.missingCurrentHashes) > 0) gates.push("missing-hash-repair");
  if (changes.license?.changed) gates.push("blocking-license-review");
  return gates;
}

export function packUpdateBranchName({ pack, to, prefix = "pack-update" }) {
  if (typeof pack !== "string" || !pack) throw new Error("pack is required");
  if (typeof to !== "string" || !to) throw new Error("to is required");
  const slug = `${pack}-${to}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return `${prefix}/${slug}`;
}

export function buildPackUpdatePacket({
  diffReport,
  updateResult = null,
  validationCommands = PACK_UPDATE_VALIDATION_COMMANDS,
  proofBoundary = PACK_UPDATE_PROOF_BOUNDARY
}) {
  assertDiffReport(diffReport);
  const changes = diffReport.changes ?? {};
  const license = changes.license ?? {};
  const skillChangeCount = CHANGE_TYPES.reduce((total, [key]) => total + count(changes[key]), 0);

  return {
    suite: PACK_UPDATE_SUITE,
    pack: diffReport.pack,
    from: {
      resolvedRef: diffReport.from.resolvedRef ?? null,
      resolvedSha: diffReport.from.resolvedSha ?? null
    },
    to: {
      resolvedRef: diffReport.to.resolvedRef ?? null,
      resolvedSha: diffReport.to.resolvedSha ?? null
    },
    changes: {
      skillChangeCount,
      hasChanges: skillChangeCount > 0 || Boolean(license.changed),
      unchangedCount: Number(changes.unchangedCount ?? 0),
      added: count(changes.added),
      removed: count(changes.removed),
      movedOrRenamed: count(changes.movedOrRenamed),
      bodyChanged: count(changes.bodyChanged),
      missingCurrentHashes: count(changes.missingCurrentHashes),
      license: {
        changed: Boolean(license.changed),
        fromBlobSha: license.fromBlobSha ?? null,
        toBlobSha: license.toBlobSha ?? null,
        path: license.path ?? null
      }
    },
    reviewGates: reviewGates(diffReport),
    updatedFiles: changedFiles(updateResult),
    validationCommands,
    releaseNoteFragment: `Update ${diffReport.pack} skill-pack provenance from ${diffReport.from.resolvedSha ?? diffReport.from.resolvedRef} to ${diffReport.to.resolvedSha ?? diffReport.to.resolvedRef}.`,
    proofBoundary
  };
}

function bulletList(values) {
  if (!values.length) return "- none";
  return values.map((value) => `- ${value}`).join("\n");
}

function sectionForChange(diffReport, changeType, label) {
  return [`### ${label}`, bulletList(changePaths(changeType, diffReport.changes?.[changeType]))].join("\n");
}

export function buildPackUpdatePrBody({
  diffReport,
  updateResult = null,
  validationCommands = PACK_UPDATE_VALIDATION_COMMANDS,
  proofBoundary = PACK_UPDATE_PROOF_BOUNDARY
}) {
  const packet = buildPackUpdatePacket({ diffReport, updateResult, validationCommands, proofBoundary });
  const license = packet.changes.license;
  const licenseLine = license.changed
    ? `changed: ${license.fromBlobSha ?? "<missing>"} -> ${license.toBlobSha ?? "<missing>"} (${license.path ?? "LICENSE"})`
    : "unchanged";

  return [
    "## Summary",
    `- update \`${packet.pack}\` lock/catalog provenance from \`${packet.from.resolvedSha}\` to \`${packet.to.resolvedSha}\``,
    `- skill changes: ${packet.changes.skillChangeCount}; unchanged: ${packet.changes.unchangedCount}; license: ${licenseLine}`,
    "- keep upstream skill bodies unvendored and keep new upstream skills hidden until catalog/eval review",
    "",
    "## Provenance Diff",
    `- pack: \`${packet.pack}\``,
    `- from ref/SHA: \`${packet.from.resolvedRef}\` / \`${packet.from.resolvedSha}\``,
    `- to ref/SHA: \`${packet.to.resolvedRef}\` / \`${packet.to.resolvedSha}\``,
    `- updated files: ${packet.updatedFiles.length ? packet.updatedFiles.map((file) => `\`${file}\``).join(", ") : "none"}`,
    "",
    ...CHANGE_TYPES.flatMap(([changeType, label]) => [
      sectionForChange(diffReport, changeType, label),
      ""
    ]),
    "### License",
    `- ${licenseLine}`,
    "",
    "## Review Gates",
    bulletList(packet.reviewGates),
    "",
    "## Validation",
    bulletList(packet.validationCommands.map((command) => `\`${command}\``)),
    "",
    "## Release Note Fragment",
    `- ${packet.releaseNoteFragment}`,
    "",
    "## Proof Boundary",
    packet.proofBoundary
  ].join("\n");
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeOutput(outputPath, body) {
  if (!outputPath) {
    console.log(body);
    return;
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, body.endsWith("\n") ? body : `${body}\n`);
}

function optionValue(name, value) {
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {
    command,
    diffPath: null,
    updatePath: null,
    outputPath: null,
    pack: null,
    to: null,
    prefix: "pack-update"
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];

    if (arg === "--diff") {
      options.diffPath = optionValue("--diff", next);
      index += 1;
    } else if (arg === "--update") {
      options.updatePath = optionValue("--update", next);
      index += 1;
    } else if (arg === "--output") {
      options.outputPath = optionValue("--output", next);
      index += 1;
    } else if (arg === "--pack") {
      options.pack = optionValue("--pack", next);
      index += 1;
    } else if (arg === "--to") {
      options.to = optionValue("--to", next);
      index += 1;
    } else if (arg === "--prefix") {
      options.prefix = optionValue("--prefix", next);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function usage() {
  return [
    "Usage: node src/pack-update-cadence.mjs <packet|pr-body|branch-name>",
    "",
    "Commands:",
    "  packet       Write deterministic update packet JSON from pack-sync diff/update JSON",
    "  pr-body      Write a draft PR body from pack-sync diff/update JSON",
    "  branch-name  Write a deterministic update branch name",
    "",
    "Options:",
    "  --diff PATH       pack-sync diff JSON path (packet/pr-body)",
    "  --update PATH     pack-sync update JSON path (optional)",
    "  --pack owner/repo pack id (branch-name)",
    "  --to sha-or-tag   target ref (branch-name)",
    "  --prefix PREFIX   branch prefix (branch-name)",
    "  --output PATH     output file instead of stdout"
  ].join("\n");
}

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }

  if (options.command === "packet" || options.command === "pr-body") {
    if (!options.diffPath) {
      console.error("--diff is required");
      console.error(usage());
      return 2;
    }
    const diffReport = await readJson(options.diffPath);
    const updateResult = options.updatePath ? await readJson(options.updatePath) : null;
    const output = options.command === "packet"
      ? `${JSON.stringify(buildPackUpdatePacket({ diffReport, updateResult }), null, 2)}\n`
      : buildPackUpdatePrBody({ diffReport, updateResult });
    await writeOutput(options.outputPath, output);
    return 0;
  }

  if (options.command === "branch-name") {
    const output = packUpdateBranchName({
      pack: options.pack,
      to: options.to,
      prefix: options.prefix
    });
    await writeOutput(options.outputPath, output);
    return 0;
  }

  console.error(usage());
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
