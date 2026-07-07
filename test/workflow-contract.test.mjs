import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readWorkflow(name) {
  return readFile(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");
}

test("CI workflow runs release preflight checks without publishing", async () => {
  const workflow = await readWorkflow("ci.yml");

  assert.match(workflow, /npm test/);
  assert.match(workflow, /node bin\/pack-sync check/);
  assert.match(workflow, /npm run smoke:openclaw-adapter/);
  assert.match(workflow, /npm run release:check/);
  assert.match(workflow, /npm run pack:dry-run/);
  assert.doesNotMatch(workflow, /npm publish/);
});

test("release-preflight workflow is manual, validates artifacts, and does not publish", async () => {
  const workflow = await readWorkflow("release-preflight.yml");

  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run eval:routing/);
  assert.match(workflow, /node bin\/pack-sync check/);
  assert.match(workflow, /npm run smoke:openclaw-adapter/);
  assert.match(workflow, /git diff --check/);
  assert.match(workflow, /npm run release:check/);
  assert.match(workflow, /node src\/release-report\.mjs notes > release-notes\.md/);
  assert.match(workflow, /npm pack --dry-run --json > npm-pack-dry-run\.json/);
  assert.doesNotMatch(workflow, /npm publish/);
});

test("upstream pack refresh workflow diffs every seed pack without writing updates", async () => {
  const workflow = await readWorkflow("upstream-pack-refresh.yml");

  assert.match(workflow, /schedule:/);
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  for (const pack of [
    "jimliu/baoyu-skills",
    "coreyhaines31/marketingskills",
    "garrytan/gstack",
    "obra/superpowers",
    "mattpocock/skills"
  ]) {
    assert.match(workflow, new RegExp(`pack-sync diff --pack ${pack.replace("/", "\\/")}`));
  }
  assert.doesNotMatch(workflow, /pack-sync update/);
});
