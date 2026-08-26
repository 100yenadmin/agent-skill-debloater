import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("..", import.meta.url);

async function readSkill(name) {
  return readFile(new URL(`skills/${name}/SKILL.md`, repoRoot), "utf8");
}

test("studio is the compact unified visible router skill", async () => {
  const body = await readSkill("studio");

  assert.match(body, /^---\nname: studio\n/m);
  assert.match(body, /CEO\/founder strategy/i);
  assert.match(body, /design\/visual work/i);
  assert.match(body, /marketing\/growth/i);
  assert.match(body, /specialized engineering workflows/i);
  assert.match(body, /direct skill or native approach fits/i);
  assert.match(body, /selecting none is valid/i);
  assert.match(body, /whole selected\s+domain catalog/i);
  assert.match(body, /plugin-local CLI/);
  assert.match(body, /parent of `skills\/`/);
  assert.match(body, /node "<plugin-root>\/bin\/debloat-skill-search" <domain>/);
  assert.match(body, /read the selected `SKILL\.md`/i);
  assert.doesNotMatch(body, /\/Users\/lume|\/Volumes\/LEXAR/);
  assert.ok(body.split(/\s+/).length < 290);
});
