const MACHINE_LOCAL_PATH_PATTERNS = [
  { name: "mac-user-home", pattern: /\/Users\/[A-Za-z0-9._-]+/g },
  { name: "linux-user-home", pattern: /\/home\/[A-Za-z0-9._-]+/g },
  { name: "mac-volume", pattern: /\/Volumes\/[^\s"'`),}\]]+/g },
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
