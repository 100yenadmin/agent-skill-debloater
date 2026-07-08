# AgentSkillDebloater Architecture

AgentSkillDebloater is a plugin-first proving ground for hidden but searchable
skill libraries. It keeps visible prompt surface small by exposing compact role
studio router skills, then searching catalogs that point at upstream skill files.

## Boundaries

- AgentSkillDebloater owns curated packs, manifests, overlays, lockfiles,
  generated catalogs, evals, release cadence, and defaults.
- OpenClaw core should eventually own only generic primitives: hidden/readable
  skill catalogs, skill-search API, ranking hooks, prompt-visibility semantics,
  selected-skill audit traces, and adapter contracts.
- Hidden/read-on-demand solves prompt bloat. It is not a security boundary.

## Flow

1. A visible role studio skill is triggered, such as `design-studio`,
   `marketing-studio`, `ceo-studio`, or `engineering-studio`.
2. The router runs `debloat-skill-search <studio> "<query>" --limit 3`.
3. Search returns compact candidate cards with source, confidence, capabilities,
   reason codes, and a read path.
4. The agent reads the chosen backing `SKILL.md` on demand.
5. The selected skill source and capability labels can be logged as an audit
   trace by the host runtime.

The OpenClaw adapter exposes this same flow as compact JSON:

```bash
agent-skill-debloater openclaw-adapter search <studio> "<query>"
```

It returns ranked candidates and `selectedSkillTrace`; it does not read or
return full backing skill bodies.

## Ranking

V1 attempts SQLite FTS5 as the default candidate-retrieval fast path, then
applies deterministic boosts for names, aliases, tags, descriptions, source
pack, use-when text, and capabilities. Search falls back to full JSON
deterministic scoring when SQLite FTS5 is unavailable in the host Node build,
the query cannot be represented safely for FTS, or the FTS candidate cap is
saturated. Voyage reranking is optional, default-off, and receives compact
candidate cards only.

## Portability

Public catalogs store pack-relative `skillPath` values. Install-time adapters
resolve those into exact local paths through `--pack-root`, lockfiles, or host
runtime pack roots. The repository must not ship machine-local absolute paths.

## Update Cadence

`pack-sync diff` compares a locked pack against an upstream ref and reports
added, removed, moved/renamed, body-changed, license-changed, and missing-hash
states without vendoring skill bodies. `pack-sync update` writes reviewed
provenance changes into locks and catalogs, then runs the same metadata check.

The scheduled upstream pack refresh workflow runs diffs only. Manual
`update-pr` runs can prepare a draft update PR for one seed pack after writing
a deterministic update packet and rerunning metadata, routing, rerank, release,
and package checks. New upstream skills remain hidden until catalog and eval
review. Neither workflow opens rollout gates, publishes npm packages, mutates
OpenClaw core, or installs defaults on customer VMs.
