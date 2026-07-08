import { execFile } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

const REQUIRED_SCRIPTS = [
  "test",
  "eval:routing",
  "eval:rerank",
  "smoke:fresh-agents",
  "release:check",
  "release:notes",
  "pack:dry-run",
  "pack:update-pr-body",
  "acceptance:clean-room",
  "acceptance:package",
  "smoke:openclaw-adapter"
];

const VALIDATION_COMMANDS = [
  "npm test",
  "npm run eval:routing",
  "npm run eval:rerank",
  "npm run smoke:fresh-agents",
  "node bin/pack-sync check",
  "npm run smoke:openclaw-adapter",
  "npm run acceptance:clean-room",
  "npm run acceptance:package",
  "git diff --check",
  "npm run pack:dry-run"
];

const REQUIRED_PACKED_FILES = [
  ".codex-plugin/plugin.json",
  "bin/agent-skill-debloater",
  "bin/debloat-skill-search",
  "bin/pack-sync",
  "catalogs/design.json",
  "catalogs/marketing.json",
  "catalogs/ceo.json",
  "catalogs/engineering.json",
  "docs/future-studios.md",
  "docs/demo-router-flow.md",
  "docs/distribution-readiness.md",
  "docs/launch-packet.md",
  "docs/openclaw-adapter-contract-fixtures.json",
  "evals/fresh-agent-smokes/v0/scenarios.json",
  "evals/skill-routing-evals/v0/scenarios.json",
  "evals/rerank-quality/v0/scenarios.json",
  "docs/openclaw-adapter.md",
  "docs/pack-update-cadence.md",
  "docs/rerank-quality.md",
  "locks/baoyu-skills.lock.json",
  "overlays/studios.json",
  "packs/baoyu-skills.json",
  "schemas/catalog.schema.json",
  "skills/design-studio/SKILL.md",
  "skills/marketing-studio/SKILL.md",
  "skills/ceo-studio/SKILL.md",
  "skills/engineering-studio/SKILL.md",
  "src/cli.mjs",
  "src/clean-room-install.mjs",
  "src/fresh-agent-smoke.mjs",
  "src/openclaw-adapter.mjs",
  "src/pack-update-cadence.mjs",
  "src/package-acceptance.mjs",
  "src/pack-sync.mjs",
  "src/release-report.mjs",
  "src/search.mjs"
];

const FORBIDDEN_PACKED_FILE_PATTERNS = [
  {
    label: "evals/skill-routing-evals/*/routing-report.json",
    pattern: /^evals\/skill-routing-evals\/[^/]+\/routing-report\.json$/
  },
  {
    label: "evals/rerank-quality/*/rerank-report.json",
    pattern: /^evals\/rerank-quality\/[^/]+\/rerank-report\.json$/
  }
];
const REQUIRED_KEYWORDS = ["agent-skills", "codex", "openclaw", "plugin", "skill-search", "skills"];
const DISTRIBUTION_DOC = "docs/distribution-readiness.md";

function toPath(input) {
  if (input instanceof URL) return fileURLToPath(input);
  if (typeof input !== "string") {
    throw new TypeError("root must be a string path or file URL");
  }
  if (input.startsWith("file:")) return fileURLToPath(input);
  return input;
}

async function readJson(root, relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function defaultReadText(root, relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

async function exists(root, relativePath) {
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function listWorkflowFiles(root) {
  const workflowDir = path.join(root, ".github/workflows");
  try {
    const entries = await readdir(workflowDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
      .map((entry) => `.github/workflows/${entry.name}`)
      .sort();
  } catch {
    return [];
  }
}

function publishSurfaceInText(text) {
  return (
    /\b(?:npm|pnpm|yarn)\b[^\n\r]*(?:\s|:)publish\b/i.test(text) ||
    /\bpublish\b[^\n\r]*(?:npm|pnpm|yarn)\b/i.test(text) ||
    /\bNPM_TOKEN\b|\bNODE_AUTH_TOKEN\b|npmrc/i.test(text) ||
    /npm\/.*publish|publish.*action/i.test(text)
  );
}

async function defaultRunPackDryRun(root) {
  const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"], {
    cwd: root,
    maxBuffer: 20 * 1024 * 1024
  });
  return JSON.parse(stdout);
}

function packedFileSet(packDryRun) {
  const first = Array.isArray(packDryRun) ? packDryRun[0] : null;
  return new Set((first?.files ?? []).map((file) => file.path).filter(Boolean));
}

function findForbiddenPackedFiles(packedFiles) {
  return [...packedFiles]
    .filter((file) => FORBIDDEN_PACKED_FILE_PATTERNS.some(({ pattern }) => pattern.test(file)))
    .sort();
}

function packageMetadataStatus(packageJson) {
  const missing = [];
  if (packageJson.repository?.type !== "git") missing.push("repository.type");
  if (packageJson.repository?.url !== "git+https://github.com/100yenadmin/agent-skill-debloater.git") {
    missing.push("repository.url");
  }
  if (packageJson.bugs?.url !== "https://github.com/100yenadmin/agent-skill-debloater/issues") {
    missing.push("bugs.url");
  }
  if (packageJson.homepage !== "https://github.com/100yenadmin/agent-skill-debloater#readme") {
    missing.push("homepage");
  }
  for (const keyword of REQUIRED_KEYWORDS) {
    if (!packageJson.keywords?.includes(keyword)) missing.push(`keywords.${keyword}`);
  }
  return {
    repository: packageJson.repository ?? null,
    bugs: packageJson.bugs ?? null,
    homepage: packageJson.homepage ?? null,
    keywords: packageJson.keywords ?? [],
    requiredKeywords: REQUIRED_KEYWORDS,
    missing
  };
}

function distributionDocStatus(text) {
  const normalized = String(text).replace(/\s+/g, " ");
  return {
    path: DISTRIBUTION_DOC,
    approvalGate: /do not run `npm publish`/i.test(normalized) && /explicitly approves publication/i.test(normalized),
    npmAvailabilityDisclaimer: /Do not document `npm install agent-skill-debloater` as generally available until/i.test(normalized),
    proofBoundary: /distribution readiness only/i.test(normalized) && /does not prove npm publication/i.test(normalized)
  };
}

export async function buildReleaseChecklist({
  root = repoRoot,
  readText,
  exists: existsImpl,
  listWorkflowFiles: listWorkflowFilesImpl,
  runPackDryRun
} = {}) {
  const absoluteRoot = path.resolve(toPath(root));
  const readTextImpl = readText ?? ((relativePath) => defaultReadText(absoluteRoot, relativePath));
  const existsFn = existsImpl ?? ((relativePath) => exists(absoluteRoot, relativePath));
  const listWorkflows = listWorkflowFilesImpl ?? (() => listWorkflowFiles(absoluteRoot));
  const runPack = runPackDryRun ?? (() => defaultRunPackDryRun(absoluteRoot));
  const packageJson = JSON.parse(await readTextImpl("package.json"));
  const manifestPresent = await existsFn(".codex-plugin/plugin.json");
  const pluginManifest = manifestPresent
    ? JSON.parse(await readTextImpl(".codex-plugin/plugin.json"))
    : null;
  const packageMetadata = packageMetadataStatus(packageJson);
  const distributionDocPresent = await existsFn(DISTRIBUTION_DOC);
  const distributionReadiness = distributionDocPresent
    ? distributionDocStatus(await readTextImpl(DISTRIBUTION_DOC))
    : {
        path: DISTRIBUTION_DOC,
        approvalGate: false,
        npmAvailabilityDisclaimer: false,
        proofBoundary: false
      };
  const missingScripts = REQUIRED_SCRIPTS.filter((script) => !packageJson.scripts?.[script]);
  const packageFiles = packageJson.files ?? [];
  const workflows = await listWorkflows();
  const workflowTexts = await Promise.all(workflows.map(async (file) => [file, await readTextImpl(file)]));
  const publishSurfaces = [
    ...Object.entries(packageJson.scripts ?? {})
      .filter(([, script]) => publishSurfaceInText(script))
      .map(([scriptName]) => `package script ${scriptName}`),
    ...workflowTexts
      .filter(([, text]) => publishSurfaceInText(text))
      .map(([file]) => `workflow ${file}`)
  ];
  const packDryRun = await runPack();
  const packedFiles = packedFileSet(packDryRun);
  const missingPackedFiles = REQUIRED_PACKED_FILES.filter((file) => !packedFiles.has(file));
  const forbiddenPackedFiles = findForbiddenPackedFiles(packedFiles);
  const ok = Boolean(
    packageJson.name === "agent-skill-debloater" &&
    packageJson.version &&
    packageFiles.includes(".codex-plugin/") &&
    manifestPresent &&
    pluginManifest?.version === packageJson.version &&
    packageMetadata.missing.length === 0 &&
    distributionReadiness.approvalGate &&
    distributionReadiness.npmAvailabilityDisclaimer &&
    distributionReadiness.proofBoundary &&
    missingScripts.length === 0 &&
    missingPackedFiles.length === 0 &&
    forbiddenPackedFiles.length === 0 &&
    publishSurfaces.length === 0
  );

  return {
    ok,
    package: {
      name: packageJson.name,
      version: packageJson.version,
      files: packageFiles
    },
    packageMetadata,
    distributionReadiness,
    pluginManifest: {
      present: manifestPresent,
      name: pluginManifest?.name ?? null,
      version: pluginManifest?.version ?? null,
      skills: pluginManifest?.skills ?? null
    },
    requiredScripts: {
      expected: REQUIRED_SCRIPTS,
      missing: missingScripts
    },
    packageContents: {
      required: REQUIRED_PACKED_FILES,
      missing: missingPackedFiles,
      forbidden: FORBIDDEN_PACKED_FILE_PATTERNS.map(({ label }) => label),
      forbiddenPresent: forbiddenPackedFiles
    },
    validationCommands: VALIDATION_COMMANDS,
    publishSurfaces,
    proofBoundary:
      "Release checks prove plugin artifact quality only; they do not prove customer VM rollout readiness."
  };
}

export async function buildReleaseNotes({ root = repoRoot } = {}) {
  const checklist = await buildReleaseChecklist({ root });
  const version = checklist.package.version;
  return [
    `# AgentSkillDebloater v${version}`,
    "",
    "## Highlights",
    "",
    "- Plugin-first Codex manifest with Design, Marketing, CEO, and Engineering router skills.",
    "- Pack provenance automation through `pack-sync diff/update` with lockfile skill blob hashes.",
    "- OpenClaw adapter JSON for compact candidates and selected-skill audit traces.",
    "- Clean-room install acceptance for router-only visibility and installed package search.",
    "- Fresh-agent smoke tasks proving router invocation, top-3 inspection, exact read paths, and hard-negative behavior.",
    "- Rerank-quality shadow evals for optional Voyage comparison without promotion.",
    "- Release/update automation for local preflight, CI preflight, and scheduled upstream pack checks.",
    "- Distribution readiness checklist for future npm/public publish review without publishing.",
    "",
    "## Validation",
    "",
    ...checklist.validationCommands.map((command) => `- \`${command}\``),
    "",
    "## Boundary",
    "",
    "- No npm publish is included in this release workflow.",
    "- Distribution state is ready-for-publish-review, not npm-published.",
    "- This release proves plugin routing and artifact quality only; it does not prove customer VM rollout readiness, OpenClaw core runtime safety, or fleet deployment safety."
  ].join("\n");
}

function usage() {
  return [
    "Usage: node src/release-report.mjs <check|notes>",
    "",
    "Commands:",
    "  check   Print release checklist JSON",
    "  notes   Print human-readable release notes"
  ].join("\n");
}

export async function releaseReportMain(argv) {
  const [command] = argv;
  if (command === "check") {
    const checklist = await buildReleaseChecklist();
    console.log(JSON.stringify(checklist, null, 2));
    return checklist.ok ? 0 : 1;
  }
  if (command === "notes") {
    console.log(await buildReleaseNotes());
    return 0;
  }
  console.error(usage());
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  releaseReportMain(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
