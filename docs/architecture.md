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

1. A visible role studio skill is triggered, such as `design-studio` or
   `marketing-studio`.
2. The router runs `debloat-skill-search <studio> "<query>" --limit 3`.
3. Search returns compact candidate cards with source, confidence, capabilities,
   reason codes, and a read path.
4. The agent reads the chosen backing `SKILL.md` on demand.
5. The selected skill source and capability labels can be logged as an audit
   trace by the host runtime.

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
