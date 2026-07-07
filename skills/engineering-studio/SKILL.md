---
name: engineering-studio
description: Use when the user asks for implementation, TDD, debugging, code review, architecture, merge conflicts, planning, PRs, subagents, worktrees, verification, or engineering execution and the right backing engineering skill should be selected without loading a large skill pack.
---

# Engineering Studio

Route engineering requests to the best hidden/read-on-demand engineering skill
without loading the whole engineering library into the prompt.

## Workflow

1. Turn the user's task into a short search query.
2. Resolve `<plugin-root>` as the plugin package root: the parent of `skills/`,
   two directories up from this file's directory.
3. Run the plugin-local CLI, not a global command:
   `node "<plugin-root>/bin/debloat-skill-search" engineering "<query>" --format text --limit 3`
4. Inspect the ranked set. If confidence is low or the top results conflict,
   ask a narrow clarification or continue with general engineering judgment.
5. Before doing the engineering work, read the returned `SKILL.md` path.
   If the path is `pack://...`, resolve it through the host adapter or rerun
   search with `--pack-root PACK=PATH`; do not broad-search the filesystem.
6. Follow that backing skill's instructions and disclose the selected source
   and capabilities when they matter.

Never paste or summarize the whole engineering catalog into the prompt.
