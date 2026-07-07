---
name: ceo-studio
description: Use when the user asks for founder judgment, CEO review, company strategy, executive operating, scope ambition, security posture, documentation direction, retrospectives, or strategic planning and the right backing CEO skill should be selected without loading a large skill pack.
---

# CEO Studio

Route founder and executive-operating requests to the best hidden/read-on-demand
CEO skill without loading the whole company-building library into the prompt.

## Workflow

1. Turn the user's task into a short search query.
2. Resolve `<plugin-root>` as the plugin package root: the parent of `skills/`,
   two directories up from this file's directory.
3. Run the plugin-local CLI, not a global command:
   `node "<plugin-root>/bin/debloat-skill-search" ceo "<query>" --format text --limit 3`
4. Inspect the ranked set. If confidence is low or the top results conflict,
   ask a narrow clarification or continue with general executive judgment.
5. Before doing the work, read the returned `SKILL.md` path.
   If the path is `pack://...`, resolve it through the host adapter or rerun
   search with `--pack-root PACK=PATH`; do not broad-search the filesystem.
6. Follow that backing skill's instructions and disclose the selected source
   and capabilities when they matter.

Never paste or summarize the whole CEO catalog into the prompt.
