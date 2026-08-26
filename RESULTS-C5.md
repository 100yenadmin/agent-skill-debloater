# C5/C7 Results

## Outcome

- Unified `skills/studio/` router replaces the four visible studio routers.
- All four active overlays still search their own catalogs (`ceo`, `design`,
  `engineering`, and `marketing`) through the shared `studio` router name.
- Removed the dead strategy docs `openclaw-core-primitives.md`,
  `runtime-canary-plan.md`, and `customer-canary-plan.md`.
- Removed the roadmap item `OpenClaw core primitive adoption`.
- Target branch: `revival/router-consolidation-v1`.
- Base: `main` at `e78c0c8`.
- Push: not performed.

## Validation

- `npm test` — 142 passed, 0 failed.
- `npm run eval:routing` — 192 scenarios; Recall@3 1.0, Top1 1.0, MRR@3 1.0,
  wrongCategory 0, negative false positives 0, threshold failures 0.
- `npm run smoke:fresh-agents` — 9 scenarios; pass rate 1.0, hard-negative
  false positives 0.
- `node bin/pack-sync check` — passed.
- `env -u AGENT_SKILL_DEBLOATER_PACK_ROOTS npm run acceptance:package` — passed;
  57 packed entries and all package scenarios passed.
- `env -u AGENT_SKILL_DEBLOATER_PACK_ROOTS npm run acceptance:clean-room` —
  passed; one visible `studio` skill and all five installed searches passed.
- `npm run release:check` — passed with no publish surfaces.
- Local plugin validator — passed.
- `git diff --check` — passed.

## Known risk

The unified router makes the model choose the domain argument. The existing
`wrongCategory` metric measures search miscategorisation inside a chosen studio,
not model-level router/domain miscategorisation; this change does not claim that
new risk is measured.

## Proof boundary

This is repo-level proof only. It does not prove the live plugin roster, plugin
cache ingestion/dispatch, OpenClaw runtime behavior, customer rollout, or fleet
readiness. `RESULTS-C5.md` is intentionally left uncommitted for handoff.
