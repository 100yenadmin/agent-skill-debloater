---
name: ceo-studio
description: Use when the user asks for founder judgment, CEO review, company strategy, executive operating, scope ambition, security posture, documentation direction, retrospectives, or strategic planning and the right backing CEO skill should be selected without loading a large skill pack.
---

# CEO Studio

Route founder and executive-operating requests to the best hidden/read-on-demand
CEO skill without loading the whole company-building library into the prompt.

## Workflow

1. Turn the user's task into a short search query.
2. Run:
   `debloat-skill-search ceo "<query>" --format text --limit 3`
3. Inspect the ranked set. If confidence is low or the top results conflict,
   ask a narrow clarification or continue with general executive judgment.
4. Before doing the work, read the returned `SKILL.md` path.
   If the path is `pack://...`, resolve it through the host adapter or rerun
   search with `--pack-root PACK=PATH`.
5. Follow that backing skill's instructions and disclose the selected source
   and capabilities when they matter.

Never paste or summarize the whole CEO catalog into the prompt.
