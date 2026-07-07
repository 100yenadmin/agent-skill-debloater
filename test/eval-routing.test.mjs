import assert from "node:assert/strict";
import test from "node:test";

import { runRoutingEval } from "../src/eval-routing.mjs";

test("routing eval checks global studio selection and hard negatives", async () => {
  const result = await runRoutingEval(new URL("../evals/skill-routing-evals/v0/scenarios.json", import.meta.url));

  assert.equal(result.metrics.wrongCategory, 0);
  assert.equal(result.metrics.negativeFalsePositive, 0);

  const pricing = result.rows.find((row) => row.id === "marketing-pricing-unseeded");
  assert.equal(pricing.selectedStudio, null);
  assert.equal(pricing.expectedSelectedStudio, null);
});
