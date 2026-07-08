# Runtime Canary And Rollback Plan

This plan is the approval gate between local AgentSkillDebloater package proof
and any customer or fleet runtime change.

## Boundary

This document is planning evidence only. It does not prove runtime safety,
customer VM readiness, OpenClaw core behavior, fleet deployment safety, or npm
publication readiness.

Do not perform any of the following from this repository or this plan without a
separate explicit approval:

- upstream OpenClaw code changes, pull requests, or merges;
- customer VM writes or customer profile mutation;
- fleet default skill-stack rollout;
- OpenClaw default bundle mutation;
- npm publication.

Hidden/read-on-demand reduces prompt bloat. It is not a security boundary.

## Phase 0: Package Gate

Required before any runtime canary:

- `npm test`
- `npm run eval:routing`
- `npm run eval:rerank`
- `npm run smoke:fresh-agents`
- `node bin/pack-sync check`
- `npm run smoke:openclaw-adapter`
- `npm run acceptance:clean-room`
- `npm run acceptance:package`
- `npm run release:check`
- `npm run pack:dry-run`
- GitHub Actions CI green on the exact candidate commit

Evidence packet:

```text
<evidence-root>/session-notes/YYYY-MM-DD/agent-skill-debloater-runtime-canary/
```

Record release/tag or commit SHA, package shasum, CI URL, plugin install source,
and the `package-acceptance/v0`, `fresh-agent-smokes/v0`, and
`clean-room-install/v0` JSON reports.

## Phase 1: Golden VM Canary

Goal: prove that one controlled Golden VM can install/load AgentSkillDebloater
without prompt bloat, stale command resolution, or wrong backing-skill reads.

Preconditions:

- package gate passed on the exact candidate artifact;
- Golden VM target, operator, and rollback owner are named;
- no customer data is present in the smoke prompts;
- upstream skill pack roots are known and pinned;
- current OpenClaw/plugin configuration is exported before change.

Smoke tasks:

- Design Studio hero or cover prompt selects `baoyu-cover-image`.
- Marketing Studio positioning prompt selects `product-marketing`.
- CEO Studio security prompt selects `cso`.
- Engineering Studio TDD prompt selects `tdd`.
- No-studio arithmetic prompt does not invoke AgentSkillDebloater.
- Marketing Studio Kubernetes hard negative returns no clear match and reads no
  backing `SKILL.md`.

Pass evidence:

- visible router skills are limited to the studio routers;
- `debloat-skill-search` resolves from the installed plugin, not a stale global
  command;
- compact top results are inspected;
- exactly one selected backing `SKILL.md` is read for positive tasks;
- whole catalogs are not loaded;
- selected skill, source, capabilities, confidence, and read path are recorded;
- hard negatives do not read backing skills.

Stop conditions:

- router skills are bypassed or large backing packs become prompt-visible;
- search uses a stale global command;
- catalog files are read wholesale;
- selected read path is unresolved, ambiguous, or outside declared pack roots;
- hard negative returns a false positive;
- prompt footprint grows materially;
- rollback cannot be executed immediately.

Rollback:

1. Disable or remove the AgentSkillDebloater plugin from the Golden VM.
2. Restore exported pre-canary OpenClaw/plugin configuration.
3. Clear any temporary pack-root environment override.
4. Re-run the pre-canary no-plugin baseline smoke.
5. Record rollback commands, timestamps, operator, and result in the evidence
   packet.

## Phase 2: One Customer VM Canary

Goal: prove the same behavior on one explicitly approved customer VM after the
Golden VM canary passes.

Additional preconditions:

- customer approval and target VM are recorded;
- customer-safe prompt set is reviewed and contains no secrets or raw customer
  data;
- rollback owner is online for the full window;
- support contact and stop channel are named;
- Golden VM evidence packet is linked.

Pass evidence is the same as the Golden VM, plus:

- customer account/VM identity is recorded in redacted form;
- no unrelated customer files, logs, browser sessions, or credentials are read;
- customer-facing behavior and latency are acceptable for the agreed smoke;
- rollback is still available until post-canary review closes.

Stop conditions:

- any Golden VM stop condition appears;
- customer data would be needed to continue;
- customer-visible degradation appears;
- support owner is unavailable;
- evidence cannot be redacted safely.

Rollback is identical to Golden VM rollback, with customer approval and support
notification recorded.

## Phase 3: Serial Rollout Proposal

Only after the customer canary passes:

- propose serial rollout batches;
- include exact candidate version, rollback version, operator, and support owner;
- require per-batch evidence packets;
- require a pause after the first batch for review;
- keep fleet default changes separate from plugin package proof.

This repository must not perform the rollout. It may provide checklists,
commands, and adapter/package evidence.

## Evidence Checklist

Every canary evidence packet must include:

- candidate commit, release, package filename, shasum, and CI URL;
- install source and plugin list before/after;
- exported pre-change configuration checksum;
- smoke prompt IDs and expected studio/skill;
- command/audit trace for each search;
- selected read path and capability labels;
- pass/fail decision for each smoke;
- hard-negative result;
- rollback command log or explicit rollback-not-needed reason;
- redaction note;
- proof boundary and next action.

## Decision States

- `blocked`: a stop condition fired or evidence is missing.
- `golden_passed`: Golden VM canary passed; customer canary may be proposed.
- `customer_passed`: one customer VM canary passed; serial rollout may be
  proposed.
- `runtime_safe`: reserved for a separate runtime-safe plan after approved
  canaries, not for this document alone.
