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

## Non-Goals

- No curated default pack list in OpenClaw core at this stage.
- No customer VM rollout from this repository alone.
- No assumption that hidden prompt visibility controls tool or data access.
