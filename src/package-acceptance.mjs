import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertNoMachineLocalPaths } from "./portable-paths.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

const SUITE = "package-acceptance/v0";
const PROOF_BOUNDARY =
  "Package acceptance proves packaged plugin artifact behavior only; it does not prove customer VM rollout readiness, OpenClaw core runtime safety, fleet deployment safety, or npm publication.";

const REQUIRED_PACKED_FILES = [
  ".codex-plugin/plugin.json",
  "bin/agent-skill-debloater",
  "bin/debloat-skill-search",
  "catalogs/design.json",
  "catalogs/marketing.json",
  "catalogs/ceo.json",
  "catalogs/engineering.json",
  "docs/future-studios.md",
  "docs/pack-update-cadence.md",
  "docs/rerank-quality.md",
  "evals/rerank-quality/v0/scenarios.json",
  "skills/design-studio/SKILL.md",
  "skills/marketing-studio/SKILL.md",
  "skills/ceo-studio/SKILL.md",
  "skills/engineering-studio/SKILL.md",
  "src/clean-room-install.mjs",
  "src/cli.mjs",
  "src/eval-rerank.mjs",
  "src/openclaw-adapter.mjs",
  "src/pack-update-cadence.mjs",
  "src/search.mjs"
];

const FORBIDDEN_PACKED_FILE_PATTERNS = [
  /^evals\/skill-routing-evals\/[^/]+\/routing-report\.json$/,
  /^evals\/rerank-quality\/[^/]+\/rerank-report\.json$/,
  /^artifacts\//,
  /^test\//
];

function toPath(input) {
  if (input instanceof URL) return fileURLToPath(input);
  if (typeof input !== "string") {
    throw new TypeError("root must be a string path or file URL");
  }
  if (input.startsWith("file:")) return fileURLToPath(input);
  return input;
}

function check(id, ok, detail = {}) {
  return { id, ok: Boolean(ok), detail };
}

function firstPack(packOutput) {
  const first = Array.isArray(packOutput) ? packOutput[0] : null;
  if (!first) throw new Error("npm pack did not return a package entry");
  return first;
}

function normalizePackageSummary(packEntry) {
  return {
    name: packEntry.name,
    version: packEntry.version,
    filename: path.basename(packEntry.filename ?? ""),
    size: packEntry.size,
    unpackedSize: packEntry.unpackedSize,
    shasum: packEntry.shasum,
    integrity: packEntry.integrity,
    entryCount: packEntry.entryCount ?? packEntry.files?.length ?? 0
  };
}

function packedFileSet(packEntry) {
  return new Set((packEntry.files ?? []).map((file) => file.path).filter(Boolean));
}

function forbiddenPackedFiles(packedFiles) {
  return [...packedFiles]
    .filter((file) => FORBIDDEN_PACKED_FILE_PATTERNS.some((pattern) => pattern.test(file)))
    .sort();
}

function candidateSummary(candidate) {
  return {
    name: candidate.name,
    source: candidate.source,
    readPath: candidate.readPath,
    confidenceLabel: candidate.confidenceLabel
  };
}

function scenarioCommandSummary(scenario) {
  return ["node", `package/${scenario.bin}`, ...scenario.args].join(" ");
}

const SCENARIOS = [
  {
    id: "adapter-design-hero",
    bin: "bin/agent-skill-debloater",
    args: [
      "openclaw-adapter",
      "search",
      "design",
      "launch hero cover image",
      "--catalog-dir",
      "package/catalogs",
      "--engine",
      "json"
    ],
    parse: "json",
    assert(response) {
      const selected = response.selectedSkillTrace;
      return {
        ok:
          response.adapter === "agent-skill-debloater/openclaw-adapter/v1" &&
          selected?.name === "baoyu-cover-image" &&
          selected.readPath === "pack://jimliu%2Fbaoyu-skills/skills/baoyu-cover-image/SKILL.md" &&
          !JSON.stringify(response).includes('"body"'),
        summary: {
          selectedSkill: selected?.name ?? null,
          selectedReadPath: selected?.readPath ?? null,
          candidates: (response.candidates ?? []).map(candidateSummary)
        }
      };
    }
  },
  {
    id: "search-marketing-hard-negative",
    bin: "bin/debloat-skill-search",
    args: [
      "marketing",
      "repair a kubernetes storage class bug",
      "--catalog-dir",
      "package/catalogs",
      "--engine",
      "json",
      "--format",
      "json"
    ],
    parse: "json",
    assert(response) {
      return {
        ok: response.studio === "marketing" && response.results?.length === 0,
        summary: {
          resultCount: response.results?.length ?? null
        }
      };
    }
  },
  {
    id: "adapter-engineering-tdd",
    bin: "bin/agent-skill-debloater",
    args: [
      "openclaw-adapter",
      "search",
      "engineering",
      "write a TDD plan for a case-insensitive todo API search filter",
      "--catalog-dir",
      "package/catalogs",
      "--engine",
      "json"
    ],
    parse: "json",
    assert(response) {
      const selected = response.selectedSkillTrace;
      return {
        ok:
          selected?.name === "tdd" &&
          selected.readPath === "pack://mattpocock%2Fskills/skills/engineering/tdd/SKILL.md",
        summary: {
          selectedSkill: selected?.name ?? null,
          selectedReadPath: selected?.readPath ?? null,
          candidates: (response.candidates ?? []).map(candidateSummary)
        }
      };
    }
  }
];

async function defaultPackPackage(root, tmpDir) {
  const { stdout } = await execFileAsync("npm", ["pack", "--json", "--pack-destination", tmpDir], {
    cwd: root,
    maxBuffer: 20 * 1024 * 1024
  });
  const packOutput = JSON.parse(stdout);
  const packEntry = firstPack(packOutput);
  return {
    packEntry,
    tarballPath: path.join(tmpDir, path.basename(packEntry.filename))
  };
}

async function defaultExtractPackage(tarballPath, tmpDir) {
  await execFileAsync("tar", ["-xzf", tarballPath, "-C", tmpDir], {
    maxBuffer: 20 * 1024 * 1024
  });
  return path.join(tmpDir, "package");
}

async function defaultRunScenario(packageRoot, scenario) {
  const args = scenario.args.map((arg) =>
    arg === "package/catalogs" ? path.join(packageRoot, "catalogs") : arg
  );
  const { stdout } = await execFileAsync(process.execPath, [path.join(packageRoot, scenario.bin), ...args], {
    maxBuffer: 20 * 1024 * 1024
  });
  const parsed = scenario.parse === "json" ? JSON.parse(stdout) : stdout;
  const assertion = scenario.assert(parsed);
  return {
    id: scenario.id,
    ok: assertion.ok,
    command: scenarioCommandSummary(scenario),
    summary: assertion.summary
  };
}

export function buildPackageAcceptanceReportFromResults({ packEntry, scenarios }) {
  const packageSummary = normalizePackageSummary(packEntry);
  const packedFiles = packedFileSet(packEntry);
  const missingPackedFiles = REQUIRED_PACKED_FILES.filter((file) => !packedFiles.has(file));
  const forbiddenPresent = forbiddenPackedFiles(packedFiles);
  const checks = [
    check("package-name", packageSummary.name === "agent-skill-debloater", {
      name: packageSummary.name
    }),
    check("package-version", Boolean(packageSummary.version), {
      version: packageSummary.version
    }),
    check("required-files", missingPackedFiles.length === 0, {
      missing: missingPackedFiles
    }),
    check("forbidden-files", forbiddenPresent.length === 0, {
      forbiddenPresent
    }),
    check("scenario-results", scenarios.every((scenario) => scenario.ok), {
      failed: scenarios.filter((scenario) => !scenario.ok).map((scenario) => scenario.id)
    })
  ];
  const report = {
    ok: checks.every((item) => item.ok),
    suite: SUITE,
    package: packageSummary,
    checks,
    scenarios,
    proofBoundary: PROOF_BOUNDARY
  };

  assertNoMachineLocalPaths(JSON.stringify(report), "package acceptance report");
  return report;
}

export async function buildPackageAcceptanceReport({
  root = repoRoot,
  packPackage = defaultPackPackage,
  extractPackage = defaultExtractPackage,
  runScenario = defaultRunScenario,
  scenarios = SCENARIOS
} = {}) {
  const absoluteRoot = path.resolve(toPath(root));
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "agent-skill-debloater-package-"));
  try {
    const { packEntry, tarballPath } = await packPackage(absoluteRoot, tmpDir);
    const packageRoot = await extractPackage(tarballPath, tmpDir);
    const scenarioResults = [];
    for (const scenario of scenarios) {
      scenarioResults.push(await runScenario(packageRoot, scenario));
    }
    return buildPackageAcceptanceReportFromResults({
      packEntry,
      scenarios: scenarioResults
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function usage() {
  return [
    "Usage: node src/package-acceptance.mjs check [--report PATH]",
    "",
    "Commands:",
    "  check   Pack, extract, smoke-test, and print package acceptance JSON"
  ].join("\n");
}

function optionValue(name, value) {
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

export async function packageAcceptanceMain(argv) {
  const [command, ...rest] = argv;
  if (command !== "check") {
    console.error(usage());
    return 2;
  }

  let reportPath = null;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--report") {
      reportPath = optionValue("--report", next);
      index += 1;
    } else {
      console.error(`Unknown argument: ${arg}`);
      console.error(usage());
      return 2;
    }
  }

  const report = await buildPackageAcceptanceReport();
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (reportPath) {
    await writeFile(reportPath, json);
  }
  console.log(json.trimEnd());
  return report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  packageAcceptanceMain(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
