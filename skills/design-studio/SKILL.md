---
name: design-studio
description: Use when the user asks for visual design, diagrams, covers, hero images, infographics, slide visuals, social cards, brand assets, UI polish, launch visuals, or design direction and the right backing design skill should be selected without loading a large skill pack.
---

# Design Studio

Route design requests to the best hidden/read-on-demand design skill without
loading the whole design library into the prompt.

## Workflow

1. Turn the user's task into a short search query.
2. Resolve `<plugin-root>` as the directory two levels above this `SKILL.md`.
3. Run the plugin-local CLI, not a global command:
   `node "<plugin-root>/bin/debloat-skill-search" design "<query>" --format text --limit 3`
4. Inspect the ranked set. If confidence is low or the top results conflict,
   ask a narrow clarification or continue with general design judgment.
5. Before doing the design work, read the returned `SKILL.md` path.
   If the path is `pack://...`, resolve it through the host adapter or rerun
   search with `--pack-root PACK=PATH`; do not broad-search the filesystem.
6. Follow that backing skill's instructions and disclose the selected source
   and capabilities when they matter.

Never paste or summarize the whole design catalog into the prompt.
