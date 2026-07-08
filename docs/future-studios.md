# Future Studio Discovery

`future-studio-discovery/v0` defines how AgentSkillDebloater evaluates future
role studios before any new prompt-visible router skill is added. This is
backlog readiness only. It is not implementation approval for any candidate
studio.

## Current Baseline

The current default-visible studios are:

- Design Studio
- Marketing Studio
- CEO Studio
- Engineering Studio

Future studios must not weaken current `skill-routing-evals/v0` behavior. The
baseline remains:

- Recall@3 >= 0.95
- Top1 >= 0.80
- MRR@3 >= 0.85
- wrong-studio rate <= 0.05 and wrong-studio count <= 1
- hard-negative false positives = 0
- no machine-local paths in public artifacts

## Candidate Studio Rubric

Each future studio needs a written discovery packet before implementation:

- target user and recurring job to be done;
- source skill packs and license/provenance posture;
- overlap analysis against existing studios;
- candidate positive prompts, hard negatives, and cross-studio ambiguity prompts;
- capability labels, including file-write, network, browser, external-posting,
  api-key-use, customer-data, and dangerous;
- minimum eval thresholds and stop conditions;
- fresh-agent smoke tasks that prove router/search/read-path behavior without
  loading entire packs.

## Candidate Backlog

| Candidate | Target User / Job | Candidate Source Packs | Overlap / Risk | Eval Requirements | Stop Conditions |
| --- | --- | --- | --- | --- | --- |
| Sales Studio | Account executives and founders doing outbound, discovery, objection handling, proposals, follow-up, CRM hygiene, and deal review. | Future sales packs, selected marketing offer/copy skills by overlay only, customer-success packs after provenance review. | High overlap with Marketing Studio for positioning/copy and Customer Success for handoff. External-posting, customer-data, browser, and CRM/API-key labels are likely. | 20+ positives, 8+ hard negatives, sales-vs-marketing ambiguity prompts, customer-data capability disclosure, fresh-agent outbound/discovery/proposal smokes. | Cannot separate from Marketing at Top1 >= 0.80, uses customer data without labels, or requires live CRM posting by default. |
| Support Studio | Support engineers and operators triaging tickets, writing customer replies, reproducing issues, and preparing escalation packets. | Future support KB packs, public support docs, selected engineering debugging skills by overlay only. | High overlap with Engineering Studio for debugging and Customer Success for communication. Customer-data, browser, network, file-write, and dangerous labels may apply. | 20+ positives, 8+ hard negatives, support-vs-engineering ambiguity prompts, escalation-path smokes, no customer-data leakage checks. | Cannot keep customer facts out of public artifacts, routes product-debugging prompts away from Engineering incorrectly, or treats hidden prompt as security. |
| Research Studio | Researchers and operators doing source-backed web research, competitive scans, citation gathering, synthesis, and freshness checks. | Future research packs, browser/search skills, selected CEO/marketing strategy skills by overlay only. | Overlaps CEO strategy and Marketing market research. Network/browser labels are likely; citation and freshness quality are the core risk. | 20+ positives, 10+ hard negatives, source-citation rubric, stale-source rejection prompts, fresh-agent research/synthesis smokes. | Cannot distinguish source-backed research from strategy ideation, lacks citation/freshness proof, or sends private context to external tools by default. |
| Ops Studio | Operators managing checklists, runbooks, releases, incident response, handoffs, and recurring execution loops. | Future operations/runbook packs, selected Superpowers planning/execution skills by overlay only. | High overlap with CEO operating cadence and Engineering release/debugging. File-write, browser, network, and dangerous labels may apply. | 20+ positives, 8+ hard negatives, ops-vs-engineering ambiguity prompts, runbook/handoff/release-smoke tasks, rollback-language checks. | Cannot separate runtime/release/customer safety boundaries, encourages unmanaged rollout, or weakens existing Engineering routing. |
| Docs Studio | Technical writers and product teams producing docs, changelogs, release notes, tutorials, API explanations, and knowledge-base updates. | Future docs/writing packs, selected marketing content and engineering explanation skills by overlay only. | Overlaps Marketing content and Engineering implementation explanations. File-write and external-posting labels may apply. | 20+ positives, 8+ hard negatives, docs-vs-marketing-vs-engineering ambiguity prompts, style/source/proof-boundary smokes. | Cannot distinguish docs from promotional copy, fabricates API details, or publishes externally without explicit capability disclosure. |
| Finance Studio | Finance operators and founders handling invoice review, revenue snapshots, cash planning, vendor review, and finance evidence packets. | Future finance/accounting packs only after privacy and license review; no customer mailbox packs by default. | Overlaps CEO planning and Ops evidence packets. Customer-data, api-key-use, browser, network, and dangerous labels are likely. | 20+ positives, 12+ hard negatives, finance-vs-CEO ambiguity prompts, stale-evidence prompts, privacy/redaction smokes. | Uses customer or finance data without explicit labels, makes financial claims without source evidence, or routes general strategy into Finance. |
| Customer Success Studio | Customer success teams handling onboarding, renewal risk, QBRs, implementation checklists, account health, and follow-up. | Future customer-success packs, selected support and sales handoff skills by overlay only. | Overlaps Sales for account communication and Support for issue triage. Customer-data, browser, network, external-posting, and CRM labels are likely. | 20+ positives, 10+ hard negatives, customer-success-vs-sales/support ambiguity prompts, onboarding/QBR/renewal smokes, customer-data disclosure checks. | Cannot separate customer lifecycle work from sales or support, leaks customer context, or requires live posting by default. |

## Required Pack Discovery Fields

Before adding a candidate pack to a future studio implementation PR, record:

- pack id and canonical repository URL;
- allowed paths and hidden-by-default policy;
- license policy and license evidence;
- upstream pin policy and lockfile update strategy;
- candidate studio mapping and possible secondary overlays;
- capability labels by skill or pack;
- known overlap with existing studios;
- eval scenario sources and excluded use cases;
- update cadence expectations.

## Promotion Checklist

A future studio implementation cannot be promoted until a separate issue and PR
provide all of the following:

- manifest, lockfile, overlay, catalog, and schema validation;
- no upstream skill-body vendoring or moved upstream skills;
- no one-tool-per-skill default visibility;
- router skill prompt surface remains compact;
- `skill-routing-evals/v0` keeps current thresholds green;
- a candidate-specific eval suite adds positives, hard negatives, and
  cross-studio ambiguity prompts;
- all candidate capability labels are visible in search results and selected
  traces;
- fresh-agent smokes show router invocation, top-3 inspection, selected
  `SKILL.md` read path, source/capability disclosure, and no whole-pack loading;
- package acceptance and release checks include the new public artifacts;
- rollout proof is explicitly out of scope unless a separate runtime-safe canary
  plan is approved.

## Non-Goals

- Do not add new router skills in this discovery lane.
- Do not add active overlay studios in this discovery lane.
- Do not move upstream skills between repos or studio folders.
- Do not claim implementation readiness for Sales, Support, Research, Ops,
  Docs, Finance, or Customer Success.
- Do not treat hidden/read-on-demand visibility as a security boundary.
