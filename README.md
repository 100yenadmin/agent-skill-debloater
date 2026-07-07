# AgentSkillDebloater

Installing packs of skills bloats context and wastes tokens. AgentSkillDebloater
turns large skill packs into hidden/read-on-demand libraries searched by tiny
visible router skills.

This repository is plugin-first. It proves the pattern outside OpenClaw core:
curated packs, studios, overlays, manifests, catalogs, evals, and release cadence
live here; OpenClaw core should eventually own only generic catalog/search
primitives.

## What Ships In v0.1

- `debloat-skill-search <studio> "<query>" --format json|text --limit 3`
- `agent-skill-debloater search <studio> "<query>"`
- `pack-sync check`
- `design-studio` and `marketing-studio` visible router skills
- portable seed catalogs for Baoyu design skills and Cory Haines marketing skills
- lockfiles with exact upstream seed commits
- manifest and studio overlay seeds
- routing eval scaffolding

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

## Proof Boundary

This proves local plugin routing only. It does not prove customer VM rollout
readiness, runtime safety, security policy, or OpenClaw core behavior. Hidden
prompt visibility reduces prompt bloat; it is not a security boundary.
