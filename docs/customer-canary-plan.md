# Opt-In Customer Canary Plan

This document supports issue #48. It is plan-only until a separate approval
names an opted-in customer, target VM, operator, support owner, and rollback
window.

## Gate Rule

Do not write to a customer VM, change a customer profile, install a plugin for a
customer, alter customer OpenClaw defaults, or perform a fleet rollout from this
plan. Customer canary execution requires a separate explicit approval comment.

Approval must name:

- customer and redacted VM identity;
- exact plugin version, tag, package URL, and checksum;
- customer approval evidence;
- operator and support owner;
- rollback owner and time window;
- prompt set and data-safety review owner;
- stop channel and escalation path.

## Preconditions

- Tagged artifact acceptance is complete.
- npm/public install proof is complete if npm is the install path.
- Golden/local runtime canary has passed and links evidence.
- Customer explicitly opts in and understands this is a canary.
- Prompt set contains no secrets, raw customer data, credentials, or private
  files.
- Pre-canary plugin/runtime configuration is exported and checksummed.
- Rollback is rehearsed or documented for the exact target.

## Opt-In Criteria

Use one low-risk customer VM only when:

- the customer has an active reason to test richer skill routing;
- the VM has no active incident or urgent production dependency;
- the customer can tolerate rollback during the same support window;
- a support owner is online for the full canary;
- the operator can stop immediately on any stop condition.

## Customer Communication Template

```text
We would like to run an opt-in AgentSkillDebloater canary on <target>. The goal
is to verify compact studio-router skill search from the released plugin
artifact. This does not change fleet defaults and can be rolled back during the
same support window. We will not use secrets, private files, or raw customer
data in smoke prompts.

Please approve or decline this canary window:
- version:
- window:
- support owner:
- rollback owner:
```

## Smoke Scope

Run only reviewed customer-safe prompts:

- Design prompt selects a Baoyu-backed visual skill.
- Marketing prompt selects a Cory Haines-backed marketing skill.
- CEO prompt selects a GStack-backed operating/security skill.
- Engineering prompt selects a Matt Pocock/Superpowers/GStack engineering skill.
- Hard negative returns no match and reads no backing skill.

Record:

- visible router skills before and after;
- selected skill, source, confidence, capabilities, and read path;
- whether exactly one backing `SKILL.md` was read;
- latency or UX issue notes;
- hard-negative behavior;
- support/customer feedback.

## Stop Conditions

Stop and roll back if:

- backing packs become prompt-visible;
- search reads whole catalogs or whole upstream packs;
- selected read path is unresolved or outside declared pack roots;
- hard negative selects a backing skill;
- customer data would be needed to continue;
- customer-visible degradation appears;
- support owner is unavailable;
- evidence cannot be redacted safely.

## Rollback

1. Disable or remove AgentSkillDebloater for the customer VM.
2. Restore exported pre-canary plugin/runtime configuration.
3. Clear pack-root environment overrides.
4. Re-run the customer-safe baseline smoke.
5. Record command log, timestamps, operator, support notification, and result.

## Success Metrics

- Positive tasks route through the expected studio.
- Top-3 candidates include the expected backing skill.
- Selected-skill audit trace includes source, capabilities, confidence, and
  read path.
- Hard negative returns no backing read.
- Customer-visible behavior remains acceptable.
- Rollback remains available until closeout is accepted.

## Proof Boundary

This plan can define an opt-in customer canary. It does not authorize customer
VM mutation, fleet rollout, runtime-safe claims, or OpenClaw core changes.
