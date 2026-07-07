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
- `pack-sync check`
- `design-studio` and `marketing-studio` visible router skills
- portable seed catalogs for Baoyu design skills and Cory Haines marketing skills
- lockfiles with exact upstream seed commits
- manifest and studio overlay seeds
- routing eval scaffolding
- public schemas and provenance checks
- SQLite FTS5 search fast path by default, with portable JSON deterministic
  fallback

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

The default search engine attempts SQLite FTS5 candidate retrieval followed by
the same deterministic scoring/boosts used by the JSON fallback. If SQLite FTS5
is not available in the host Node build, the query cannot be represented safely
for FTS, or the candidate cap is saturated, search falls back to full
deterministic JSON scoring so top-3 ordering and exact-name matches stay
stable. Force the portable fallback when needed:

```bash
debloat-skill-search marketing "positioning ICP" --engine json --format json
```

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

## Proof Boundary

This proves local plugin routing only. It does not prove customer VM rollout
readiness, runtime safety, security policy, or OpenClaw core behavior. Hidden
prompt visibility reduces prompt bloat; it is not a security boundary.
