# Rerank Quality Eval

`rerank-quality` is an advisory shadow comparison for optional rerank
providers: Voyage reranking (`voyage`) and TypeSafe Jev picking (`jev`). It
exists to collect evidence before any future proposal to let a provider
influence result ordering.

```bash
npm run eval:rerank
npm run eval:rerank:v1 -- --providers voyage,jev --candidate-limit 10
```

To write a full report:

```bash
node src/eval-rerank.mjs evals/rerank-quality/v0/scenarios.json \
  --summary \
  --report artifacts/rerank-quality/v0/report.json
```

## Suites

- `v0`: 6 overlap scenarios, run by `npm run eval:rerank`.
- `v1`: 50 scenarios, all labelled before the Jev pilot: the 6 `v0` scenarios,
  plus the 39 curated-intent positives and the 5 curated-intent hard negatives
  from `skill-routing-evals/v0`. Each scenario records its `provenance`.

## Options

- `--scenarios PATH`: the scenario file. A positional path also works.
- `--providers voyage,jev`: the providers to compare. The default is `voyage`.
- `--candidate-limit N`: how many deterministic candidates each provider
  receives (default 5). A per-scenario `limit` overrides it.

## Scoring

- A provider only reorders the deterministic top-N; it never adds candidates.
  Providers receive the prompt and compact candidate cards only. They never
  receive the scenario record or its expected skill.
- Positive scenarios report Top1, Recall@3 and MRR@3, computed on the rows
  where the provider completed. Jev ranks its `none` option among the
  candidates by probability, so an abstention on a positive scenario counts
  against it.
- A negative scenario (`expectedSkill: null`) is correct when deterministic
  search returns nothing, or when the provider abstains (Jev picks `none`).
- Each provider reports status counts, latency, privacy leak counts and its
  own promotion verdict. The top-level `statusCounts`, `metrics`, `privacy` and
  `promotion` fields mirror the first provider, which keeps the `v0` report
  shape.

## CI Behavior

CI does not require `VOYAGE_API_KEY` or `TYPESAFE_API_KEY`. When a key is
absent, every scenario that has candidates records `skipped-missing-api-key`.
Deterministic metrics and privacy checks still run, and the command exits
successfully.

With a key, the eval sends each provider compact candidate cards only. It never
sends full skill bodies, resolved local `readPath` values, private context,
customer data, or the user's surrounding conversation.

## Promotion Criteria

Both providers must stay shadow-only unless a separate approved issue shows:

- at least 5% absolute MRR@3 or Top1 gain;
- no Recall@3 loss;
- no hard-negative regression: a provider must not pick a skill for more "no skill" requests than
  deterministic search does (reported per provider as `negatives`; the eval adds `hard-negative-regression`);
- no privacy regression;
- clean timeout/fallback behavior;
- current routing eval thresholds remain green.

This eval may report `promotion.eligible: true`, but that is not approval to
promote ordering behavior. Promotion requires a separate plan, PR, review, and
approval.

The first live `v1` run is recorded in `RESULTS-JEV-SHADOW.md`. Neither
provider was eligible. Deterministic search already has 44/45 positives at
Top1, so this suite cannot show a promotion-sized gain.

## Proof Boundary

This proves rerank comparison and reporting only. It does not prove customer
VM rollout readiness, OpenClaw core runtime safety, promotion of Voyage
ordering or Jev picks, or fleet deployment safety.
