import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("..", import.meta.url);
const funnelNames = ["ceo-studio", "design-studio", "engineering-studio", "marketing-studio"];
const expectedTriggers = {
  "ceo-studio": /founder|CEO|strategy|security|governance/i,
  "design-studio": /visual|diagram|cover|hero|infographic|slide|brand|UI/i,
  "engineering-studio": /implementation|TDD|debugging|testing|refactoring|TypeScript|code review/i,
  "marketing-studio": /positioning|ICP|offers|SEO|GEO|content|copywriting|growth|launch|ads/i
};

async function readSkill(name) {
  return readFile(new URL(`skills/${name}/SKILL.md`, repoRoot), "utf8");
}

function description(body) {
  return body.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
}

function stubWords(body) {
  const stub = body.split(/^---\s*$/m).slice(2).join(" ");
  return stub.trim().split(/\s+/).filter(Boolean).length;
}

test("four domain funnels carry rich intake descriptions and thin shared-flow stubs", async () => {
  const skillDirs = (await readdir(new URL("../skills/", import.meta.url), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(skillDirs, funnelNames.slice().sort());
  await assert.rejects(access(new URL("skills/studio/SKILL.md", repoRoot)));

  for (const name of funnelNames) {
    const body = await readSkill(name);
    const desc = description(body);
    assert.match(body, new RegExp(`^---\\nname: ${name}\\n`, "m"));
    assert.ok(desc.length >= 500, `${name} description should preserve rich trigger coverage`);
    assert.ok(desc.length <= 600, `${name} description exceeds the catalog budget`);
    assert.match(desc, expectedTriggers[name]);
    assert.match(desc, /direct skill or native approach fits/i);
    assert.match(desc, /search only this domain's catalog/i);
    assert.match(body, /sets? the task domain/i);
    assert.match(body, /\.\.\/studio-flow\.md/);
    assert.ok(stubWords(body) <= 60, `${name} funnel stub exceeds 60 words`);
    assert.doesNotMatch(body, /debloat-skill-search/);
  }
});

test("shared funnel flow is the only full routing instruction source", async () => {
  const flow = await readFile(new URL("skills/studio-flow.md", repoRoot), "utf8");

  assert.match(flow, /^# Studio Funnel Flow/m);
  for (let step = 1; step <= 7; step += 1) assert.match(flow, new RegExp(`^${step}\\.`, "m"));
  assert.match(flow, /Turn the task into a short search query/i);
  assert.match(flow, /parent of `skills\//i);
  assert.match(flow, /debloat-skill-search" <domain>/);
  assert.match(flow, /two domains match closely/i);
  assert.match(flow, /one short clarifying question/i);
  assert.match(flow, /cards are sufficient for selection/i);
  assert.match(flow, /at most\s+one/i);
  assert.match(flow, /authorized task will execute it/i);
  assert.match(flow, /may not\s+expand scope/i);
  assert.match(flow, /selecting none is valid/i);
  assert.match(flow, /selected `SKILL\.md` path/i);
  assert.match(flow, /whole selected domain catalog/i);
});
