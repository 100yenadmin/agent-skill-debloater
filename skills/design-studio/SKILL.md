---
name: design-studio
description: Use when the user asks for visual design, diagrams, covers, hero images, infographics, slide visuals, social cards, brand assets, UI polish, launch visuals, or design direction and the right backing design skill should be selected without loading a large skill pack.
---

# Design Studio

Route design requests to the best hidden/read-on-demand design skill without
loading the whole design library into the prompt.

## Workflow

1. Turn the user's task into a short search query.
2. Run:
   `debloat-skill-search design "<query>" --format text --limit 3`
3. Inspect the ranked set. If confidence is low or the top results conflict,
   ask a narrow clarification or continue with general design judgment.
4. Before doing the design work, read the returned `SKILL.md` path.
   If the path is `pack://...`, resolve it through the host adapter or rerun
   search with `--pack-root PACK=PATH`.
5. Follow that backing skill's instructions and disclose the selected source
   and capabilities when they matter.

Never paste or summarize the whole design catalog into the prompt.
