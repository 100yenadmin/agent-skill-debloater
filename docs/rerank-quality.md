# Rerank Quality Eval

`rerank-quality/v0` is an advisory shadow comparison for optional Voyage
reranking. It exists to collect evidence before any future proposal to let a
reranker influence result ordering.

```bash
npm run eval:rerank
```

To write a full report:

```bash
node src/eval-rerank.mjs evals/rerank-quality/v0/scenarios.json \
  --summary \
  --report artifacts/rerank-quality/v0/report.json
```

## CI Behavior

CI does not require `VOYAGE_API_KEY`. When the key is absent, every scenario
records `skipped-missing-api-key`, deterministic metrics are still reported,
privacy checks still run, and the command exits successfully.

With `VOYAGE_API_KEY`, the eval calls Voyage with compact candidate cards only.
It never sends full skill bodies, resolved local `readPath` values, private
context, customer data, or the user's surrounding conversation.

## Promotion Criteria

Voyage ordering must stay shadow-only unless a separate approved issue shows:

- at least 5% absolute MRR@3 or Top1 gain;
- no Recall@3 loss;
- no privacy regression;
- clean timeout/fallback behavior;
- current routing eval thresholds remain green.

This eval may report `promotion.eligible: true`, but that is not approval to
promote ordering behavior. Promotion requires a separate plan, PR, review, and
approval.

## Proof Boundary

This proves rerank comparison/reporting only. It does not prove customer VM
rollout readiness, OpenClaw core runtime safety, Voyage ordering promotion, or
fleet deployment safety.
