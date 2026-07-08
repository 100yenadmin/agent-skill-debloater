# Roadmap

## v0.1.0

- Import the local pilot with portable paths.
- Ship Marketing Studio and Design Studio router skills.
- Ship JSON lexical search and compact top-3 output.
- Add manifest, lockfile, overlay, capability-label, and catalog seeds for
  Baoyu and Cory Haines marketing skills.
- Add seed `skill-routing-evals/v0` with CI thresholds.
- Add a default-off Voyage rerank interface that only emits compact candidate
  cards in shadow mode.

## v0.2.0

- Add formal manifest, lockfile, overlay, capability-label, and catalog schemas.
- Generate catalogs from upstream packs instead of hand-authored seeds.

## v0.3.0

- Add SQLite FTS5 search with deterministic boosts.
- Harden confidence thresholds and top-3 output contracts against larger packs.

## v0.4.0

- Expand `skill-routing-evals/v0` to cover all seeded pack skills, hard
  negatives, ambiguity prompts, and cross-studio selection.

## v0.5.0

- Implement live optional Voyage rerank in shadow mode.
- Release shadow mode only while deterministic routing evals remain green.
- Do not promote Voyage ordering without a separate rerank-quality eval proving
  no Recall@3 regression and meaningful MRR/Top1 lift.

## v0.6.0

- Add CEO Studio and Engineering Studio.
- Add seed pack coverage for GStack, Superpowers, Matt Pocock skills, Baoyu, and
  Cory Haines marketing skills.
- Preserve upstream pack provenance through overlays and lockfiles without
  vendoring upstream skill bodies.

## v1.0.0

- Stabilize schemas and Codex plugin manifest packaging.
- Add `pack-sync diff/update` provenance automation with skill blob hashes.
- Add manual release preflight and scheduled upstream pack diff workflows.
- Pass routing thresholds.
- Prove the OpenClaw local adapter smoke and selected-skill audit trace.
- Customer VM readiness remains a separate canary plan.

## Deferred After v1.0

- OpenClaw core primitive adoption.
- Runtime/customer canary rollout.
- npm publication.
- Promoting Voyage rerank from shadow mode to ordering behavior.

## Phase 2

- Add packaged install acceptance reports so release proof exercises the built
  tarball instead of only the source checkout.
- Write the runtime-safe canary and rollback plan before any customer VM or
  fleet rollout.
- Harden plugin-side OpenClaw adapter contracts without upstream OpenClaw code
  changes.
- Prepare npm/public distribution readiness without publishing.
- Add a rerank-quality eval before any Voyage ordering promotion.
- Operationalize upstream pack update PR cadence.
- Plan future studios through `docs/future-studios.md` discovery/eval rubrics
  before adding new visible router skills.
