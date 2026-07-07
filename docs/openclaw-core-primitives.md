# OpenClaw Core Primitive Proposal

AgentSkillDebloater should not bake curated pack policy into OpenClaw core.
Instead, it should prove the behavior as a plugin and feed generic primitives
back into core only after eval and adapter evidence.

## Proposed Core Primitives

- Hidden/readable skill catalogs: backing skills can be readable by exact path
  without being default prompt-visible.
- Skill-search API: a runtime surface for querying catalogs without loading all
  skills into every turn.
- Ranking hooks: host-provided hooks for lexical, FTS, embedding, or rerank
  implementations.
- Prompt-visibility semantics: explicit visible router skills versus hidden
  backing skills.
- Selected-skill audit traces: record selected skill, source pack, confidence,
  capability labels, and read path.
- Adapter contracts: plugins can provide catalogs and studio overlays without
  forking runtime policy.

## Adapter Shape Proven

AgentSkillDebloater exposes a plugin-local adapter first:

```bash
agent-skill-debloater openclaw-adapter search <studio> "<query>"
```

The response contains compact ranked `candidates` and a `selectedSkillTrace`
with source pack, capability labels, confidence, why, source URL, and exact
`SKILL.md` read path. This is the minimum useful primitive for OpenClaw core:
query a hidden catalog, record what the agent selected, and let the agent read
only the chosen backing skill.

## Ownership Split

OpenClaw core should eventually own generic primitives:

- catalog registration and prompt visibility semantics
- search API and ranking/rerank hooks
- read-path resolution and selected-skill audit traces
- capability labels as policy inputs

AgentSkillDebloater should continue to own curated policy:

- seed pack manifests, overlays, locks, and catalogs
- studio UX defaults
- update cadence and release notes
- routing evals and pack provenance checks

## Non-Goals

- No curated default pack list in OpenClaw core at this stage.
- No customer VM rollout from this repository alone.
- No assumption that hidden prompt visibility controls tool or data access.
