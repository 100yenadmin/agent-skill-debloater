---
name: marketing-studio
description: Use when the user asks for positioning, ICP, offers, SEO, GEO, content strategy, copywriting, growth, launches, customer research, ads, or marketing planning and the right backing marketing skill should be selected without loading a large skill pack.
---

# Marketing Studio

Route marketing requests to the best hidden/read-on-demand marketing skill
without loading the whole marketing library into the prompt.

## Workflow

1. Turn the user's task into a short search query.
2. Run:
   `debloat-skill-search marketing "<query>" --format text --limit 3`
3. Inspect the ranked set. If confidence is low or the top results conflict,
   ask a narrow clarification or continue with general marketing judgment.
4. Before doing the marketing work, read the returned `SKILL.md` path.
   If the path is `pack://...`, resolve it through the host adapter or rerun
   search with `--pack-root PACK=PATH`.
5. Follow that backing skill's instructions and disclose the selected source
   and capabilities when they matter.

Never paste or summarize the whole marketing catalog into the prompt.
