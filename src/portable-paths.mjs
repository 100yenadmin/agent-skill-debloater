import path from "node:path";

const MACHINE_LOCAL_PATH_PATTERNS = [
  { name: "mac-user-home", pattern: /\/Users\/[A-Za-z0-9._-]+/g },
  { name: "linux-user-home", pattern: /\/home\/[A-Za-z0-9._-]+/g },
  { name: "mac-volume", pattern: /\/Volumes\/[^\n\r"'`),}\]]+/g },
  { name: "workspace-root", pattern: /\/workspaces\/[^\n\r"'`),}\]]+/g },
  { name: "tmp-root", pattern: /\/tmp\/[^\n\r"'`),}\]]+/g },
  { name: "windows-user-home", pattern: /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`),}\]]+/g }
];

export function findMachineLocalPaths(body) {
  const text = String(body ?? "");
  const matches = [];

  for (const { name, pattern } of MACHINE_LOCAL_PATH_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      matches.push({ name, value: match[0] });
    }
  }

  return matches;
}

export function assertNoMachineLocalPaths(body, label) {
  const matches = findMachineLocalPaths(body);
  if (matches.length > 0) {
    const values = matches.map((match) => `${match.name}:${match.value}`).join(", ");
    throw new Error(`Machine-local path found in ${label}: ${values}`);
  }
}

export function assertPortableRelativePath(value, label, { allowGlob = false } = {}) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string path`);
  }
  if (value.startsWith("file:")) {
    throw new Error(`${label} must not be a file: URL`);
  }
  if (path.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new Error(`${label} must not be an absolute path`);
  }
  if (value.includes("\\")) {
    throw new Error(`${label} must use POSIX separators`);
  }
  const normalized = path.posix.normalize(value);
  if (!allowGlob && (normalized !== value || normalized === ".." || normalized.startsWith("../"))) {
    throw new Error(`${label} must stay inside its root`);
  }
  if (allowGlob && (normalized === ".." || normalized.startsWith("../") || value.includes("../"))) {
    throw new Error(`${label} must stay inside its root`);
  }
}

export function assertHttpUrl(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty URL string`);
  }
  if (value.startsWith("file:")) {
    throw new Error(`${label} must not be a file: URL`);
  }
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${label} must be an http(s) URL`);
  }
}
