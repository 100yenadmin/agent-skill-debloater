# Debloater pack refresh results

Date: 2026-08-26
Branch: `revival/pack-refresh-v1`
Base: `379b7563f419ae46df3e6abb1a2f6e2e13d35725`

## Pins and catalog changes

| Pack | Old pin | New pin | Upstream diff | Catalog result |
| --- | --- | --- | --- | --- |
| `garrytan/gstack` | `11de390be1be6849eb9a15f91ff4922dd16c589a` | `ad8400543cd9ce8d07641362db48d44a95417e33` | 53 body changes, 5 unchanged, no adds/removes | 52 surviving entries refreshed |
| `obra/superpowers` | `d884ae04edebef577e82ff7c4e143debd0bbec99` | `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` | 14 body changes | 13 duplicate entries removed; `brainstorming` retained as the single schema-required sentinel |
| `mattpocock/skills` | `8515a080a74dbcf5019a1a78efc24b5fcafb36b8` | `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76` | 10 adds, 11 removals, 25 body changes | 22 entries refreshed; dead `to-issues`, `to-prd`, and `writing-great-skills` dropped |
| `jimliu/baoyu-skills` | `6b7a2e417500561a5ecdd0b168332f4142584617` | unchanged | no changes | 5 entries unchanged |
| `coreyhaines31/marketingskills` | `6c6017451dcd340f3aaab3e354e28eed8aa782aa` | `becd60ee9df07f7d595c26e092253ba49f7a9ffc` | 3 adds, 27 body changes | 8 existing entries refreshed; new upstream skills remain lock-only per pack-sync policy |

The Superpowers lock keeps all 14 current upstream skill paths, while catalog exposure is limited to the sentinel entry because the lock schema requires at least one catalog file and the visible plugin already exposes the duplicate skills.

The existing gstack checkout was clean at `8f8c7b3c4cc77070e4e010242bfcb8c061f2bb12`, not the refreshed `ad840054...` pin. It was intentionally not touched; its unchanged paths were used for path-resolution evidence only.

## Resolution canary

The canary ran 3 representative `node bin/debloat-skill-search <studio> "<probe>" --format json --limit 3` searches per studio using the live `AGENT_SKILL_DEBLOATER_PACK_ROOTS` mapping. Every returned absolute `readPath` passed `fs.existsSync`.

| Studio | Catalog entries resolving | Rate | CLI result cards checked | Rate |
| --- | ---: | ---: | ---: | ---: |
| `ceo` | 16/16 | 100% | 7/7 | 100% |
| `design` | 5/5 | 100% | 6/6 | 100% |
| `engineering` | 59/59 | 100% | 9/9 | 100% |
| `marketing` | 8/8 | 100% | 7/7 | 100% |
| **Overall** | **88/88** | **100%** | **29/29** | **100%** |

As a lock-list spot check, all 180 listed skill paths resolved: gstack 58/58, Superpowers 14/14, Matt 37/37, Baoyu 21/21, and Marketing 50/50. The gstack result is path reachability only because its protected existing checkout could not be moved to the refreshed pin.

## Validation

- `node bin/pack-sync check` — PASS; all pack, lock, overlay, schema, and catalog provenance checks passed.
- `node --test test/router-skills.test.mjs` — PASS, 4/4.
- `npm run eval:routing` — PASS, `skill-routing-evals/v0`, 192 scenarios; recall@3 1.0, top1 1.0, MRR@3 1.0, wrong-category 0, negative false positives 0, threshold failures `[]`. The 36 scenarios tied only to removed entries were removed; surviving thresholds were unchanged.
- `npm run smoke:fresh-agents` — PASS, `fresh-agent-smokes/v0`, 9 scenarios, pass rate 1.0, hard-negative false positives 0.
- `npm test` — PASS, 145/145 tests.

## Proof boundary

This proves local catalog/lock integrity and read-path reachability on this machine. It does not prove roster behavior, router consolidation (C5), our-skills ingestion (C6), upstream runtime behavior, release, fleet, or customer readiness.
