import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("..", import.meta.url);

async function readSkill(name) {
  return readFile(new URL(`skills/${name}/SKILL.md`, repoRoot), "utf8");
}

test("design-studio is a compact visible router skill", async () => {
  const body = await readSkill("design-studio");

  assert.match(body, /^---\nname: design-studio\n/m);
  assert.match(body, /visual design/i);
  assert.match(body, /debloat-skill-search design/);
  assert.match(body, /read the returned `SKILL\.md`/);
  assert.doesNotMatch(body, /\/Users\/lume|\/Volumes\/LEXAR/);
  assert.ok(body.split(/\s+/).length < 290);
});

test("marketing-studio is a compact visible router skill", async () => {
  const body = await readSkill("marketing-studio");

  assert.match(body, /^---\nname: marketing-studio\n/m);
  assert.match(body, /positioning/i);
  assert.match(body, /debloat-skill-search marketing/);
  assert.match(body, /read the returned `SKILL\.md`/);
  assert.doesNotMatch(body, /\/Users\/lume|\/Volumes\/LEXAR/);
  assert.ok(body.split(/\s+/).length < 290);
});

test("ceo-studio is a compact visible router skill", async () => {
  const body = await readSkill("ceo-studio");

  assert.match(body, /^---\nname: ceo-studio\n/m);
  assert.match(body, /founder judgment/i);
  assert.match(body, /debloat-skill-search ceo/);
  assert.match(body, /read the returned `SKILL\.md`/);
  assert.doesNotMatch(body, /\/Users\/lume|\/Volumes\/LEXAR/);
  assert.ok(body.split(/\s+/).length < 290);
});

test("engineering-studio is a compact visible router skill", async () => {
  const body = await readSkill("engineering-studio");

  assert.match(body, /^---\nname: engineering-studio\n/m);
  assert.match(body, /implementation/i);
  assert.match(body, /debloat-skill-search engineering/);
  assert.match(body, /read the returned `SKILL\.md`/);
  assert.doesNotMatch(body, /\/Users\/lume|\/Volumes\/LEXAR/);
  assert.ok(body.split(/\s+/).length < 290);
});
