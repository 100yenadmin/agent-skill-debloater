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
  assert.match(workflow, /node src\/fresh-agent-smoke\.mjs evals\/fresh-agent-smokes\/v0\/scenarios\.json/);
  assert.match(workflow, /name: fresh-agent-smokes-v0-node-\$\{\{ matrix\.node-version \}\}/);
  assert.match(workflow, /npm run acceptance:clean-room -- --report artifacts\/clean-room-install\/v0\/report-node-\$\{\{ matrix\.node-version \}\}\.json/);
  assert.match(workflow, /name: clean-room-install-v0-node-\$\{\{ matrix\.node-version \}\}/);
  assert.match(workflow, /npm run release:check/);
  assert.match(workflow, /npm run pack:dry-run/);
  assert.doesNotMatch(workflow, /npm publish/);
});

test("release-preflight workflow is manual, validates artifacts, and does not publish", async () => {
  const workflow = await readWorkflow("release-preflight.yml");

  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run eval:routing/);
  assert.match(workflow, /npm run smoke:fresh-agents -- --report fresh-agent-smokes\.json/);
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
  const diffJob = workflow.split("  prepare-update-pr:")[0];

  assert.match(workflow, /schedule:/);
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(diffJob, /permissions:\n      contents: read/);
  for (const pack of [
    "jimliu/baoyu-skills",
    "coreyhaines31/marketingskills",
    "garrytan/gstack",
    "obra/superpowers",
    "mattpocock/skills"
  ]) {
    assert.match(workflow, new RegExp(`pack-sync diff --pack ${pack.replace("/", "\\/")}`));
  }
  assert.doesNotMatch(diffJob, /pack-sync update/);
});

test("upstream pack refresh workflow can prepare manual draft update PRs", async () => {
  const workflow = await readWorkflow("upstream-pack-refresh.yml");
  const updateJob = workflow.split("  prepare-update-pr:")[1];

  assert.match(workflow, /mode:/);
  assert.match(workflow, /update-pr/);
  assert.match(updateJob, /permissions:\n      contents: write\n      pull-requests: write/);
  assert.match(updateJob, /update-pr mode requires one concrete seed pack/);
  assert.match(updateJob, /pack-sync diff --pack "\$PACK_ID" --to "\$TARGET_REF"/);
  assert.match(updateJob, /pack-sync update --pack "\$PACK_ID" --to "\$TARGET_REF"/);
  assert.match(updateJob, /node bin\/pack-sync check > artifacts\/pack-sync\/pack-check\.json/);
  assert.match(updateJob, /npm run eval:routing/);
  assert.match(updateJob, /npm run eval:rerank/);
  assert.match(updateJob, /node src\/pack-update-cadence\.mjs packet/);
  assert.match(updateJob, /node src\/pack-update-cadence\.mjs pr-body/);
  assert.match(updateJob, /gh pr create --draft/);
  assert.match(updateJob, /upstream-pack-update-pr-packet/);
  assert.doesNotMatch(updateJob, /npm publish/);
});
