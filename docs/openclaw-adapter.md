# OpenClaw Adapter

AgentSkillDebloater stays plugin-first. The adapter is a thin compatibility
surface for OpenClaw/Codex runtimes that want hidden/read-on-demand skill
catalogs without adopting curated pack policy in core.

## CLI Smoke

```bash
agent-skill-debloater openclaw-adapter search design "launch hero cover image"
```

The command prints JSON with:

- `adapter`: stable adapter identifier.
- `request`: studio, query, limit, and search engine.
- `candidates`: compact ranked cards with `name`, `source`, `capabilities`,
  confidence, `why`, and exact `readPath`.
- `selectedSkillTrace`: audit trace for the first candidate, or `null` when
  no clear match exists.

The adapter does not return or read full upstream skill bodies. Agents should
inspect the returned top candidates, choose the relevant one, then read the
exact `SKILL.md` path from `readPath`.

## Programmatic API

```js
import { searchOpenClawSkillCatalog } from "agent-skill-debloater/src/openclaw-adapter.mjs";

const response = await searchOpenClawSkillCatalog({
  studio: "engineering",
  query: "debug this flaky production bug systematically",
  limit: 3
});
```

Use `--pack-root PACK=PATH` or `packRoots` only at install/runtime resolution
time. Public catalogs and release artifacts stay repo-relative and portable.

## Boundary

This adapter proves the plugin contract only. It does not mutate OpenClaw core,
install customer VM defaults, enforce tool policy, or treat hidden prompts as a
security boundary.
