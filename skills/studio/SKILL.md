---
name: studio
description: Use for CEO/founder strategy, design/visual work, marketing/growth, or specialized engineering workflows. Do not use when a direct skill or native approach fits, or to load a whole domain catalog; choose one domain and search only its catalog.
---

# Studio Router

Use this router for CEO/founder strategy, design/visual work,
marketing/growth, or specialized engineering workflows. Do not use it when a
direct skill or native approach fits; engineering search is optional and
selecting none is valid. Never paste, summarize, or load the whole selected
domain catalog into the prompt.

1. Pick one domain using these boundaries:
   - `design`: visual design, diagrams, covers, hero images, infographics, slides, social cards, brand assets, UI polish, launch visuals, and design direction
   - `marketing`: positioning, ICP, offers, SEO, GEO, content strategy, copywriting, growth, launches, customer research, ads, and marketing planning
   - `ceo`: founder judgment, CEO review, company strategy, executive operating, scope ambition, security posture, documentation direction, retrospectives, and strategic planning
   - `engineering`: long-tail engineering workflows, debugging, planning, code review, TypeScript, and implementation
2. Turn the task into a short search query.
3. Resolve `<plugin-root>` as the plugin package root: the parent of `skills/`,
   two directories up from this file's directory.
4. Run the plugin-local CLI:
   `node "<plugin-root>/bin/debloat-skill-search" <domain> "<query>" --format text --limit 3`
5. Inspect the ranked candidates. Use the engineering catalog only when no
   direct or native approach fits, and selecting no backing skill is valid.
6. Read the selected `SKILL.md` path. If it is `pack://...`, resolve it
   through the host adapter or rerun search with `--pack-root PACK=PATH`.

Keep the search scoped to the chosen domain, disclose the selected source and
capabilities when they matter, and never load the whole domain catalog.
