# Package Acceptance

`package-acceptance/v0` proves the packaged artifact, not just the source tree.
It is the local release gate for "can this tarball behave like the plugin we
intend to ship?"

```bash
npm run acceptance:package
npm run smoke:fresh-agents
npm run acceptance:clean-room
```

To save a shareable JSON report:

```bash
node src/package-acceptance.mjs check --report artifacts/package-acceptance.json
node src/fresh-agent-smoke.mjs evals/fresh-agent-smokes/v0/scenarios.json --summary --report artifacts/fresh-agent-smokes.json
node src/clean-room-install.mjs check --report artifacts/clean-room-install.json
```

The command:

- runs `npm pack --json` into a temporary directory;
- extracts the produced `.tgz`;
- runs the extracted package CLI against extracted package catalogs;
- verifies compact OpenClaw adapter output for Design and Engineering;
- verifies a Marketing hard-negative returns no match;
- checks required package files and forbidden generated/test artifacts;
- emits a portable JSON report without machine-local temp paths.

The report includes package metadata, checks, compact scenario summaries, and a
proof boundary. It does not include full skill bodies or local temp paths.

`clean-room-install/v0` adds the install-shape check for GA readiness: it packs
the artifact, installs it into a fresh local profile shape, confirms the plugin
exposes only the four studio router `SKILL.md` files, confirms catalogs contain
compact projections rather than backing skill bodies, and runs installed CLI
searches for Design, Marketing, CEO, Engineering, and a hard negative.

`fresh-agent-smokes/v0` is the local proxy for fresh-agent routing behavior. It
requires positive Design, Marketing, CEO, and Engineering prompts, an ambiguity
prompt, and a hard negative to inspect top-3 search results, identify the exact
backing `SKILL.md` path, disclose source/capability labels, and avoid loading
whole backing packs.

## Proof Boundary

Package acceptance proves packaged plugin artifact behavior only. It does not
prove customer VM rollout readiness, OpenClaw core runtime safety, fleet
deployment safety, or npm publication.
