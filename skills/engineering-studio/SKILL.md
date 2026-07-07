---
name: engineering-studio
description: Use when the user asks for implementation, TDD, debugging, code review, architecture, merge conflicts, planning, PRs, subagents, worktrees, verification, or engineering execution and the right backing engineering skill should be selected without loading a large skill pack.
---

# Engineering Studio

Route engineering requests to the best hidden/read-on-demand engineering skill
without loading the whole engineering library into the prompt.

## Workflow

1. Turn the user's task into a short search query.
2. Run:
   `debloat-skill-search engineering "<query>" --format text --limit 3`
3. Inspect the ranked set. If confidence is low or the top results conflict,
   ask a narrow clarification or continue with general engineering judgment.
4. Before doing the engineering work, read the returned `SKILL.md` path.
   If the path is `pack://...`, resolve it through the host adapter or rerun
   search with `--pack-root PACK=PATH`.
5. Follow that backing skill's instructions and disclose the selected source
   and capabilities when they matter.

Never paste or summarize the whole engineering catalog into the prompt.
