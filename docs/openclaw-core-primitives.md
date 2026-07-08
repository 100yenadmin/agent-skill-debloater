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

## Current Plugin To Future Core Mapping

| Plugin surface | Future OpenClaw primitive |
| --- | --- |
| `catalogs/*.json` | Hidden/readable catalog registry |
| `debloat-skill-search` | Runtime skill-search API |
| deterministic scoring and FTS fallback | Ranking hook contract |
| optional Voyage shadow rerank | Rerank hook contract with privacy limits |
| `pack://<encoded-pack>/<skillPath>` | Portable read-path resolver |
| visible studio router `SKILL.md` files | Prompt-visibility semantics |
| `selectedSkillTrace` | Selected-skill audit trace |
| capability labels | Runtime policy inputs, not policy enforcement |

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

## Compatibility Risks

- Ranking drift can silently change which backing skill an agent reads.
- Hidden prompt visibility can be mistaken for security policy.
- Host-specific path resolution can leak machine-local absolute paths.
- Capability labels can be ignored unless the runtime treats them as policy
  inputs.
- Audit traces can become noisy or privacy-sensitive if they include full skill
  bodies, resolved local paths, or user/customer context.
- Curated pack defaults can ossify in core if the plugin/core ownership split is
  not preserved.

## Migration Path

1. Keep AgentSkillDebloater as the proving ground for curated packs, overlays,
   locks, update cadence, and evals.
2. Stabilize the plugin adapter response contract and selected-skill audit trace.
3. Add an OpenClaw-native experimental catalog/search surface only after an
   explicit upstream approval.
4. Run plugin and native search side by side in shadow mode.
5. Promote native primitives only when routing evals and runtime canaries prove
   no loss of Recall@3, no wrong-category regression, no body leakage, and no
   prompt-bloat regression.
6. Keep curated studio defaults in this repository even if OpenClaw adopts the
   generic primitives.

## Upstream Approval Gate

Issue #46 is not approval to open upstream OpenClaw PRs. Before any upstream
OpenClaw work starts, a maintainer must explicitly approve:

- target OpenClaw repository and branch;
- primitive scope;
- adapter compatibility expectations;
- runtime safety proof required before merge;
- rollback and deprecation path;
- owner for review, merge, and release coordination.

No upstream OpenClaw code changes, pull requests, merges, or runtime config
changes are authorized by this document.

## Evidence Required Before Upstreaming

- green plugin CI on the candidate commit;
- `skill-routing-evals/v0` metrics at or above thresholds;
- `fresh-agent-smokes/v0` green;
- clean-room and package acceptance green;
- selected-skill traces from plugin adapter smoke;
- runtime canary plan approval and, for runtime claims, Golden/local canary
  evidence;
- documented compatibility and migration plan.

## Rollback And Deprecation

If native OpenClaw primitives are later introduced and fail canary proof:

- keep AgentSkillDebloater plugin routing as the fallback path;
- disable native catalog/search surfaces behind the runtime feature flag;
- preserve existing plugin manifests and router skills;
- record selected-skill trace diffs and failing scenarios;
- avoid changing curated defaults in OpenClaw core.

## Non-Goals

- No curated default pack list in OpenClaw core at this stage.
- No customer VM rollout from this repository alone.
- No assumption that hidden prompt visibility controls tool or data access.
- No upstream OpenClaw pull request, merge, or runtime mutation without a later
  explicit approval.
