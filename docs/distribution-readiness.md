# Distribution Readiness

AgentSkillDebloater can be reviewed for future public distribution, but this
repository does not publish to npm without a separate explicit approval.

## Current State

- Package name: `agent-skill-debloater`
- Package version: `1.0.2-rc.2`
- Decision state: `ready-for-publish-review`
- npm publication state: not published by this workflow
- Approval gate: do not run `npm publish`, create registry credentials, add
  npm publish workflows, or use `NPM_TOKEN`/`NODE_AUTH_TOKEN` unless a future
  maintainer explicitly approves publication in a new issue or release task.
- npm publication gate: `docs/npm-publication-gate.md`
- Launch packet: `docs/launch-packet.md`
- Router-flow demo transcript: `docs/demo-router-flow.md`

## Package Metadata

`package.json` must include:

- name, version, description, license, engines, and CLI `bin` entries;
- repository, bugs, homepage, and relevant keywords;
- a bounded `files` allowlist that includes plugin, CLI, docs, schemas,
  catalogs, eval scenarios, locks, packs, overlays, skills, and source files.

The package must not include generated eval reports, local acceptance reports,
machine-local paths, secrets, npm tokens, customer data, or upstream skill
bodies.

## Install Notes

Before npm publication is approved, install from the repository or a reviewed
GitHub release artifact. Do not document `npm install agent-skill-debloater` as
generally available until a maintainer completes and records an explicit npm
publication step.

After publication is explicitly approved and completed, release notes may add:

```bash
npm install agent-skill-debloater
```

## Required Preflight

Run these before any publish-review decision:

```bash
npm test
npm run eval:routing
npm run eval:rerank
npm run smoke:fresh-agents
node bin/pack-sync check
npm run smoke:openclaw-adapter
npm run acceptance:clean-room
npm run acceptance:package
git diff --check
npm run release:check
npm run pack:dry-run
```

For a shareable evidence packet, save:

```bash
node src/package-acceptance.mjs check --report artifacts/package-acceptance.json
node src/fresh-agent-smoke.mjs evals/fresh-agent-smokes/v0/scenarios.json --summary --report artifacts/fresh-agent-smokes.json
node src/clean-room-install.mjs check --report artifacts/clean-room-install.json
npm pack --dry-run --json > artifacts/npm-pack-dry-run.json
node src/release-report.mjs check > artifacts/release-check.json
```

Review the dry-run package `files[]`, shasum, integrity, unpacked size, and
entry count. Treat the shasum/integrity as evidence for that exact source tree
only; they will change when source, docs, package metadata, or generated
catalogs change.

## Approval Checklist

- `docs/npm-publication-gate.md` is complete and current.
- `release:check` reports `ok: true`.
- `publishSurfaces` is empty.
- `fresh-agent-smokes/v0` passes positives, ambiguity, and hard-negative scenarios.
- `clean-room-install/v0` reports only router skills visible and no backing body exposure.
- package metadata is complete.
- `docs/distribution-readiness.md` is packaged.
- `npm pack --dry-run --json` includes only expected portable artifacts.
- no workflow or script can publish to npm.
- no registry credentials are referenced.
- the release owner explicitly records whether publication is approved or
  deferred.

## Proof Boundary

This checklist proves distribution readiness only. It does not prove npm
publication, customer VM rollout readiness, OpenClaw core runtime safety,
runtime policy enforcement, or fleet deployment safety.
