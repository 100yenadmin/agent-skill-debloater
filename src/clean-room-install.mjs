import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertNoMachineLocalPaths } from "./portable-paths.mjs";
import { parsePackReadPath } from "./search.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

const SUITE = "clean-room-install/v0";
const PROOF_BOUNDARY =
  "Clean-room install proves packaged plugin visibility and local search behavior only; it does not prove customer VM rollout readiness, OpenClaw core runtime safety, fleet deployment safety, or npm publication.";

const EXPECTED_ROUTER_SKILLS = [
  { name: "ceo-studio", path: "skills/ceo-studio/SKILL.md" },
  { name: "design-studio", path: "skills/design-studio/SKILL.md" },
  { name: "engineering-studio", path: "skills/engineering-studio/SKILL.md" },
  { name: "marketing-studio", path: "skills/marketing-studio/SKILL.md" }
];

const EXPECTED_STUDIOS = ["design", "marketing", "ceo", "engineering"];
const FORBIDDEN_CATALOG_BODY_FIELDS = ["body", "content", "instructions", "markdown"];
const FORBIDDEN_RESULT_BODY_FIELDS = [
  ...FORBIDDEN_CATALOG_BODY_FIELDS,
  "rawBody",
  "skillBody",
  "skillMarkdown"
];

const SCENARIOS = [
  {
    id: "design-hero",
    studio: "design",
    query: "launch hero cover image",
    expectedTopSkill: "baoyu-cover-image"
  },
  {
    id: "marketing-positioning",
    studio: "marketing",
    query: "positioning and ICP for a new developer tool",
    expectedTopSkill: "product-marketing"
  },
  {
    id: "ceo-security-posture",
    studio: "ceo",
    query: "review our security posture and secrets exposure",
    expectedTopSkill: "cso"
  },
  {
    id: "engineering-tdd",
    studio: "engineering",
    query: "write a TDD plan for a case-insensitive todo API search filter",
    expectedTopSkill: "tdd"
  },
  {
    id: "marketing-hard-negative",
    studio: "marketing",
    query: "repair a kubernetes storage class bug",
    expectedResultCount: 0
  }
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

function expectedSkillPaths() {
  return EXPECTED_ROUTER_SKILLS.map((skill) => skill.path).sort();
}

function expectedSkillNames() {
  return EXPECTED_ROUTER_SKILLS.map((skill) => skill.name).sort();
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function extraValues(actual, expected) {
  const expectedSet = new Set(expected);
  return actual.filter((value) => !expectedSet.has(value)).sort();
}

function missingValues(actual, expected) {
  const actualSet = new Set(actual);
  return expected.filter((value) => !actualSet.has(value)).sort();
}

function isPortableSkillPath(value) {
  if (typeof value !== "string" || !value.endsWith("/SKILL.md")) return false;
  if (path.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  if (value.includes("\\")) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== ".." && !normalized.startsWith("../");
}

function findForbiddenFields(value, forbiddenFields, prefix = "$") {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findForbiddenFields(item, forbiddenFields, `${prefix}[${index}]`));
  }

  const found = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${prefix}.${key}`;
    if (forbiddenFields.includes(key)) {
      found.push(childPath);
    }
    found.push(...findForbiddenFields(child, forbiddenFields, childPath));
  }
  return found;
}

function isValidPackReadPath(readPath) {
  if (typeof readPath !== "string") return false;
  try {
    const { skillPath } = parsePackReadPath(readPath);
    return isPortableSkillPath(skillPath);
  } catch {
    return false;
  }
}

function visibleRouterSkillCheck(visibleSkills) {
  const names = sortedUnique(visibleSkills.map((skill) => skill.name));
  const expected = expectedSkillNames();
  return check("visible-router-skills", names.length === expected.length && missingValues(names, expected).length === 0, {
    expected,
    visible: names,
    missing: missingValues(names, expected),
    extra: extraValues(names, expected)
  });
}

function backingSkillBodiesHiddenCheck(allSkillFiles) {
  const files = sortedUnique(allSkillFiles);
  const expected = expectedSkillPaths();
  return check("backing-skill-bodies-hidden", files.length === expected.length && missingValues(files, expected).length === 0, {
    expectedSkillFiles: expected,
    visibleSkillFiles: files,
    missingSkillFiles: missingValues(files, expected),
    extraSkillFiles: extraValues(files, expected)
  });
}

function catalogCompactCheck(catalogSummaries) {
  const failed = catalogSummaries
    .filter(
      (catalog) =>
        catalog.entryCount < 1 || catalog.bodyFieldCount > 0 || catalog.nonPortableSkillPathCount > 0
    )
    .map((catalog) => catalog.studio);
  const studios = sortedUnique(catalogSummaries.map((catalog) => catalog.studio));
  const missingStudios = missingValues(studios, EXPECTED_STUDIOS);

  return check("catalogs-compact-and-portable", failed.length === 0 && missingStudios.length === 0, {
    failed,
    missingStudios,
    catalogs: catalogSummaries
  });
}

function scenarioCheck(scenarios) {
  return check("installed-cli-scenarios", scenarios.every((scenario) => scenario.ok), {
    failed: scenarios.filter((scenario) => !scenario.ok).map((scenario) => scenario.id)
  });
}

export function buildCleanRoomInstallReportFromResults({
  packageSummary,
  pluginSummary,
  visibleSkills,
  allSkillFiles,
  catalogSummaries,
  scenarios
}) {
  const checks = [
    check("package-name", packageSummary.name === "agent-skill-debloater", {
      name: packageSummary.name
    }),
    check("plugin-skills-path", pluginSummary.skillsPath === "./skills/", {
      skillsPath: pluginSummary.skillsPath
    }),
    visibleRouterSkillCheck(visibleSkills),
    backingSkillBodiesHiddenCheck(allSkillFiles),
    catalogCompactCheck(catalogSummaries),
    scenarioCheck(scenarios)
  ];

  const report = {
    ok: checks.every((item) => item.ok),
    suite: SUITE,
    package: packageSummary,
    plugin: pluginSummary,
    visibleSkills: [...visibleSkills].sort((a, b) => a.name.localeCompare(b.name)),
    catalogs: catalogSummaries,
    scenarios,
    checks,
    proofBoundary: PROOF_BOUNDARY
  };

  assertNoMachineLocalPaths(JSON.stringify(report), "clean-room install report");
  return report;
}

async function walkFiles(root, prefix = "") {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }

  return files;
}

function parseSkillName(body, fallback) {
  const match = body.match(/^name:\s*([^\n\r]+)/m);
  return match ? match[1].trim() : fallback;
}

async function readVisibleSkills(installedRoot) {
  const skillFiles = (await walkFiles(path.join(installedRoot, "skills")))
    .filter((file) => file.endsWith("/SKILL.md") || file === "SKILL.md")
    .map((file) => path.posix.join("skills", file))
    .sort();

  const visibleSkills = [];
  for (const file of skillFiles) {
    const body = await readFile(path.join(installedRoot, file), "utf8");
    visibleSkills.push({
      name: parseSkillName(body, path.basename(path.dirname(file))),
      path: file
    });
  }

  return { visibleSkills, allSkillFiles: skillFiles };
}

async function summarizeCatalogs(installedRoot) {
  const summaries = [];
  for (const studio of EXPECTED_STUDIOS) {
    const entries = JSON.parse(await readFile(path.join(installedRoot, "catalogs", `${studio}.json`), "utf8"));
    const bodyFieldCount = entries.filter((entry) =>
      FORBIDDEN_CATALOG_BODY_FIELDS.some((field) => Object.hasOwn(entry, field))
    ).length;
    const nonPortableSkillPathCount = entries.filter((entry) => !isPortableSkillPath(entry.skillPath)).length;
    summaries.push({
      studio,
      entryCount: entries.length,
      bodyFieldCount,
      nonPortableSkillPathCount
    });
  }
  return summaries;
}

async function runScenario(installedRoot, scenario) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      path.join(installedRoot, "bin", "debloat-skill-search"),
      scenario.studio,
      scenario.query,
      "--format",
      "json",
      "--limit",
      "3",
      "--engine",
      "json",
      "--catalog-dir",
      path.join(installedRoot, "catalogs")
    ],
    { maxBuffer: 20 * 1024 * 1024 }
  );
  const response = JSON.parse(stdout);
  const results = response.results ?? [];
  const readPaths = results.map((result) => result.readPath);
  const resultCount = results.length;
  const topSkill = results[0]?.name ?? null;
  const bodyLeakFields = findForbiddenFields(results, FORBIDDEN_RESULT_BODY_FIELDS);
  const invalidReadPaths = readPaths.filter((readPath) => !isValidPackReadPath(readPath));
  const expectedResultCount =
    typeof scenario.expectedResultCount === "number" ? resultCount === scenario.expectedResultCount : true;
  const expectedTopSkill = scenario.expectedTopSkill ? topSkill === scenario.expectedTopSkill : true;

  return {
    id: scenario.id,
    ok: expectedResultCount && expectedTopSkill && bodyLeakFields.length === 0 && invalidReadPaths.length === 0,
    summary: {
      studio: scenario.studio,
      resultCount,
      topSkill,
      readPaths,
      hasBodies: bodyLeakFields.length > 0,
      hasBodyLeaks: bodyLeakFields.length > 0,
      bodyLeakFields,
      invalidReadPaths,
      readPathsArePackUris: invalidReadPaths.length === 0
    }
  };
}

async function defaultPackPackage(root, tmpDir) {
  const { stdout } = await execFileAsync("npm", ["pack", "--json", "--pack-destination", tmpDir], {
    cwd: root,
    maxBuffer: 20 * 1024 * 1024
  });
  const packOutput = JSON.parse(stdout);
  const packEntry = Array.isArray(packOutput) ? packOutput[0] : null;
  if (!packEntry) throw new Error("npm pack did not return a package entry");
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

async function defaultInstallPackage(packageRoot, tmpDir) {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const installedRoot = path.join(
    tmpDir,
    "codex-home",
    "plugins",
    "cache",
    "agent-skill-debloater-local",
    "agent-skill-debloater",
    packageJson.version
  );
  await cp(packageRoot, installedRoot, { recursive: true });
  return installedRoot;
}

export async function buildCleanRoomInstallReport({
  root = repoRoot,
  packPackage = defaultPackPackage,
  extractPackage = defaultExtractPackage,
  installPackage = defaultInstallPackage,
  scenarios = SCENARIOS
} = {}) {
  const absoluteRoot = path.resolve(toPath(root));
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "agent-skill-debloater-clean-room-"));
  try {
    const { packEntry, tarballPath } = await packPackage(absoluteRoot, tmpDir);
    const packageRoot = await extractPackage(tarballPath, tmpDir);
    const installedRoot = await installPackage(packageRoot, tmpDir);
    const pluginJson = JSON.parse(await readFile(path.join(installedRoot, ".codex-plugin", "plugin.json"), "utf8"));
    const { visibleSkills, allSkillFiles } = await readVisibleSkills(installedRoot);
    const catalogSummaries = await summarizeCatalogs(installedRoot);
    const scenarioResults = [];
    for (const scenario of scenarios) {
      scenarioResults.push(await runScenario(installedRoot, scenario));
    }

    return buildCleanRoomInstallReportFromResults({
      packageSummary: normalizePackageSummary(packEntry),
      pluginSummary: {
        skillsPath: pluginJson.skills,
        defaultPromptCount: pluginJson.interface?.defaultPrompt?.length ?? 0
      },
      visibleSkills,
      allSkillFiles,
      catalogSummaries,
      scenarios: scenarioResults
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function usage() {
  return [
    "Usage: node src/clean-room-install.mjs check [--report PATH]",
    "",
    "Commands:",
    "  check   Pack, install into a fresh local profile, smoke-test, and print JSON"
  ].join("\n");
}

function optionValue(name, value) {
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

export async function cleanRoomInstallMain(argv) {
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

  const report = await buildCleanRoomInstallReport();
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (reportPath) {
    await writeFile(reportPath, json);
  }
  console.log(json.trimEnd());
  return report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cleanRoomInstallMain(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
