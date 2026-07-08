# AgentSkillDebloater

Installing packs of skills bloats context and wastes tokens. AgentSkillDebloater
turns large skill packs into hidden/read-on-demand libraries searched by tiny
visible router skills.

This repository is plugin-first. It proves the pattern outside OpenClaw core:
curated packs, studios, overlays, manifests, catalogs, evals, and release cadence
live here; OpenClaw core should eventually own only generic catalog/search
primitives.

## What Ships

- `debloat-skill-search <studio> "<query>" --format json|text --limit 3`
- `agent-skill-debloater search <studio> "<query>"`
- `agent-skill-debloater openclaw-adapter search <studio> "<query>"`
- `agent-skill-debloater clean-room-install check`
- `agent-skill-debloater package-acceptance check`
- `pack-sync check`, `pack-sync diff`, and `pack-sync update`
- `.codex-plugin/plugin.json` for Codex/OpenClaw plugin installation
- `design-studio`, `marketing-studio`, `ceo-studio`, and `engineering-studio`
  visible router skills
- portable seed catalogs for Baoyu design skills, Cory Haines marketing skills,
  GStack, Superpowers, and Matt Pocock skills
- lockfiles with exact upstream seed commits
- manifest and studio overlay seeds
- routing eval scaffolding
- public schemas and provenance checks
- SQLite FTS5 search fast path by default, with portable JSON deterministic
  fallback
- optional Voyage rerank shadow mode for compact candidate cards
- rerank-quality shadow evals for optional Voyage comparison without promotion
- release preflight and scheduled upstream pack diff workflows

## Schema Contracts

Public JSON schemas live under `schemas/`:

- `pack.schema.json` for human-authored pack manifests in `packs/`
- `lock.schema.json` for generated lockfiles in `locks/`
- `overlay.schema.json` for studio overlays in `overlays/`
- `catalog.schema.json` for generated searchable catalogs in `catalogs/`
- `capabilities.schema.json` for capability labels

`pack-sync check` validates those schemas plus portability and provenance rules:
catalog entries must point at declared packs, exact lock SHAs, allowed manifest
paths, matching GitHub blob URLs, matching studio catalog files, and active
overlay studios with declared packs. Deferred studios track future roadmap packs
through `plannedPacks`; `packs` is reserved for manifest-backed bindings.
Generated lockfiles can also record upstream `skills[]` blob hashes and license
blob hashes so `pack-sync diff` can report adds, removals, moves, body changes,
and license changes without vendoring upstream skill bodies.

## Example

```bash
debloat-skill-search marketing "AI SEO content plan" --format text --limit 3
```

Search returns compact candidate cards: skill name, source, confidence, why,
capabilities, and a `SKILL.md` read path. Public catalogs store pack-relative
paths, so installed runtimes can resolve exact local paths with pack roots:

```bash
debloat-skill-search design "architecture diagram" \
  --pack-root jimliu/baoyu-skills=/path/to/baoyu-skills
```

Hosts can provide pack roots once for all router skill searches:

```bash
export AGENT_SKILL_DEBLOATER_PACK_ROOTS='{"jimliu/baoyu-skills":"/path/to/baoyu-skills"}'
```

The default search engine attempts SQLite FTS5 candidate retrieval followed by
the same deterministic scoring/boosts used by the JSON fallback. If SQLite FTS5
is not available in the host Node build, the query cannot be represented safely
for FTS, or the candidate cap is saturated, search falls back to full
deterministic JSON scoring so top-3 ordering and exact-name matches stay
stable. Force the portable fallback when needed:

```bash
debloat-skill-search marketing "positioning ICP" --engine json --format json
```

CEO and Engineering studios use the same interface:

```bash
debloat-skill-search ceo "think bigger and review this plan" --format text
debloat-skill-search engineering \
  "debug this flaky production bug systematically before proposing fixes" \
  --format text
```

For OpenClaw/Codex adapter smoke, use the plugin-local JSON adapter:

```bash
agent-skill-debloater openclaw-adapter search design "launch hero cover image"
```

The adapter returns compact candidates plus `selectedSkillTrace`. It does not
read or return full skill bodies.

Optional Voyage reranking is default-off and shadow-only. It does not reorder the
normal search results; JSON output reports whether Voyage would have changed the
top candidate. The API receives compact candidate cards only: names, source
metadata, descriptions, tags, aliases, capabilities, confidence, why, and
pack-relative `SKILL.md` paths. Full skill bodies and resolved local read paths
are not sent.

```bash
VOYAGE_API_KEY=... debloat-skill-search marketing "launch copy" \
  --rerank voyage \
  --format json
```

Set `VOYAGE_RERANK_MODEL` to override the default `rerank-2.5-lite` model.
Set `VOYAGE_RERANK_TIMEOUT_MS` to tune the request timeout. Missing keys,
timeouts, or API failures leave the primary search results intact and record the
rerank status in JSON.

The routing eval gate proves deterministic search quality only. Voyage ordering
must stay shadow-only until a separate rerank-quality eval proves lift without
Recall@3 regression.

Run the advisory rerank comparison gate:

```bash
npm run eval:rerank
```

Without `VOYAGE_API_KEY`, the suite exits cleanly with
`skipped-missing-api-key` rows. With a key, it records shadow ranking deltas and
promotion eligibility, but still does not reorder normal search results.

## Pack Updates

Check current metadata:

```bash
node bin/pack-sync check
```

Preview upstream drift without writing files:

```bash
node bin/pack-sync diff --pack jimliu/baoyu-skills --to main
```

Update lock/catalog provenance after reviewing the diff:

```bash
node bin/pack-sync update --pack jimliu/baoyu-skills --to main
```

Updates preserve upstream repositories as source of truth. Catalogs remain
curated overlays; new upstream skills are not made router-visible until a
catalog/eval change selects them.

The `Upstream pack refresh` workflow runs scheduled diff-only reports for seed
packs. Maintainers can run it manually in `update-pr` mode for one concrete pack
to create a draft PR with provenance diff, eval commands, and proof boundary.
See `docs/pack-update-cadence.md`.

Future studios such as Sales, Support, Research, Ops, Docs, Finance, and
Customer Success are discovery backlog only. See `docs/future-studios.md` for
the rubric, eval requirements, and promotion checklist. No new router skill is
added by that backlog.

## Routing Evals

Run the routing gate with a compact console summary:

```bash
npm run eval:routing
```

Write the full audit report, including selected-skill traces and failure rows:

```bash
node src/eval-routing.mjs evals/skill-routing-evals/v0/scenarios.json \
  --summary \
  --report artifacts/skill-routing-evals/v0/report.json
```

Run the rerank-quality shadow eval:

```bash
npm run eval:rerank
```

## Release Preflight

```bash
npm run release:check
npm run release:notes
npm run eval:rerank
npm run smoke:fresh-agents
npm run smoke:openclaw-adapter
npm run acceptance:clean-room
npm run acceptance:package
npm run pack:dry-run
```

GitHub Actions includes CI, a manual release preflight workflow, and an upstream
pack refresh workflow. Scheduled pack refresh runs are diff-only; manual
`update-pr` runs can prepare reviewed draft update PRs. The release workflow
does not publish to npm.

`npm run acceptance:package` packs the repo, extracts the produced tarball, runs
the extracted package CLIs, and emits a portable `package-acceptance/v0` report.
See `docs/package-acceptance.md` for the report boundary and checks.
`npm run acceptance:clean-room` additionally installs the packed artifact into a
fresh local profile shape, confirms only router skills are visible, and proves
catalog-backed searches stay read-on-demand.
`npm run smoke:fresh-agents` runs the local fresh-agent proxy suite for Design,
Marketing, CEO, Engineering, one ambiguity prompt, and one hard negative. It
records the router, top-3 search result set, selected `SKILL.md` read path,
source/capability disclosure, and whole-pack-loading guard.

Runtime rollout remains separate from package proof. Use
`docs/runtime-canary-plan.md` for the Golden VM, one-customer canary, rollback,
and evidence checklist before any customer or fleet change.

Use `docs/distribution-readiness.md` for the future npm/public distribution
review checklist. The package is not considered npm-published until a maintainer
explicitly approves and records a separate publish step.

## Proof Boundary

This proves local plugin routing only. It does not prove customer VM rollout
readiness, runtime safety, security policy, or OpenClaw core behavior. Hidden
prompt visibility reduces prompt bloat; it is not a security boundary.
