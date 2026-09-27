# Jev Shadow Rerank Results

## Outcome

- Added TypeSafe Jev as a default-off shadow skill picker (`--rerank jev`) next
  to the existing Voyage shadow reranker. Neither provider changes the primary
  search results.
- Jev gets one System One `choice` question. Its options are the deterministic
  top-N candidate cards (the same compact cards Voyage gets) plus `none`.
- `src/eval-rerank.mjs` now scores a map of providers. For each provider it
  reports Top1, Recall@3, MRR@3, negative-case accuracy, status counts, latency,
  privacy leaks and the promotion verdict.
- Scorers now receive only `{ query, candidateCards }`. Before this change the
  whole scenario was passed to them, including `expectedSkill`.
- New suite `evals/rerank-quality/v1/scenarios.json` has 50 scenarios, all
  labelled before this pilot: the 6 `rerank-quality/v0` scenarios, the 39
  curated-intent positives and the 5 curated-intent hard negatives from
  `skill-routing-evals/v0`. Each entry records its `provenance`.
- Base: `main` at `a19b3f0`. Branch: `feat/jev-shadow-rerank`.

## Live eval

Command (keys set per process from the keychain):
`npm run eval:rerank:v1 -- --providers voyage,jev --summary --candidate-limit N`,
run twice at N=5 and twice at N=10 on 2026-09-28. Models: Voyage
`rerank-2.5-lite`, Jev `jev-1.13.0` (the response confirmed `jev-1.13.0`).

The 45 positives are scored on completed rows only. Every provider completed
all 45, so the completed set is the same as the full positive set.

| Candidate limit | Ranker | Top1 | Recall@3 | MRR@3 | Negatives correct | Would change top-1 | p50 / p95 latency |
|---|---|---|---|---|---|---|---|
| 5 | deterministic | 0.978 (44/45) | 1.000 | 0.989 | 5/5 | – | – |
| 5 | voyage | 0.978 | 1.000 | 0.989 | 5/5 | 0/45 | 204 / 240 ms |
| 5 | jev | 0.978 | 1.000 | 0.989 | 5/5 | 0/45 | 230 / 266 ms |
| 10 | deterministic | 0.978 (44/45) | 1.000 | 0.989 | 5/5 | – | – |
| 10 | voyage | 0.978 | 1.000 | 0.989 | 5/5 | 0/45 | 204 / 268 ms |
| 10 | jev | 0.978 | 1.000 | 0.989 | 5/5 | 0/45 | 241 / 293 ms |

Latency figures are from run 1. Run 2 was within about 35 ms at p95.

- **Status counts, every run and both providers:** `completed` 45,
  `skipped-empty-candidates` 5. There were no `failed`, `invalid-response` or
  timeout rows.
- **Privacy leaks, every run and both providers:** 0 body and 0 `readPath`,
  counted both on the candidate cards and on the cards each provider returned.
  `thresholdFailures` was `[]` in every run.
- **Stability between the two runs:**
  - Top-1 was identical on 45/45 rows for both providers at both limits.
  - The full candidate order was identical for Voyage on 45/45 rows at both
    limits. For Jev it was identical on 45/45 at N=5 and 44/45 at N=10.
  - Jev confidence moved by at most 0.09 at N=5 and 0.02 at N=10.
- **The one miss:** `engineering-code-review-overlap` expects `code-review`.
  Deterministic search, Voyage and Jev all put `review` first and `code-review`
  second.
  - Jev's confidence on this row (0.68 at N=5, 0.77 at N=10) was its lowest in
    the suite. Its median confidence was 1.0.
  - This is one data point. It does not show that Jev confidence is calibrated.
- **Jev abstentions:** 0 across all runs.
- **Spend:**
  - Jev used 199,286 input tokens over the four runs plus 1,206 for the
    fixture call. At $0.042 per million input tokens that is about $0.01.
  - Voyage tokens are not metered by this harness. At 180 small rerank calls
    the cost is estimated at under $0.01.

## Promotion verdict

Neither provider is eligible. The reason is `insufficient-mrr-or-top1-gain`,
and every delta is 0.

The v1 suite cannot show a promotion-sized gain. Deterministic search already
has 44/45 positives at Top1, so the largest possible Top1 gain is
1/45 = 0.022. That is below the 0.05 promotion bar. On these labels the result
is "no regression and no lift" for both providers. It is not evidence that
either provider would add value on harder prompts.

## Validation

- `npm test`: 152 passed, 0 failed (143 existing tests plus 9 new).
- `npm run eval:rerank` (v0, keyless): 6 scenarios, all
  `skipped-missing-api-key`, no threshold failures.
- `npm run eval:routing`: 192 scenarios, Recall@3 1.0, no threshold failures.
- `npm run release:check` and
  `env -u AGENT_SKILL_DEBLOATER_PACK_ROOTS npm run acceptance:package`: both
  passed.
- `git diff --check`: passed.
- The Jev wire format was checked against `typesafe-sdk` 0.7.2
  (`prepare_system_one`) and one live call. The sanitized exchange is in
  `test/fixtures/jev-systemone-choice.json`.

## Proof Boundary

- **What this proves:** at the repo level, both shadow providers run without
  failures on the 50-scenario v1 suite. Neither leaks skill bodies or local
  read paths. Neither changes a correct deterministic pick. Both are stable
  between runs at candidate limits 5 and 10.
- **Negatives were not tested against the providers.** Deterministic search
  returns no candidates for all 5 hard negatives, so neither provider was
  called on them. The 5/5 negative score is deterministic search's result.
  Jev's `none` option is covered by stubbed unit tests only.
- **No lift is shown.** The suite has almost no headroom (the largest possible
  Top1 gain is 0.022). A harder labelled suite with near-miss candidates and
  negatives that do produce candidates is needed before any promotion case.
- **What this does not prove:** promotion of Voyage ordering or Jev picks,
  that Jev confidence is calibrated, behaviour on real user prompts, customer
  VM or fleet rollout readiness, or OpenClaw runtime safety. Both providers
  stay default-off and shadow-only. Promotion needs a separate approved PR, as
  `docs/rerank-quality.md` requires.
