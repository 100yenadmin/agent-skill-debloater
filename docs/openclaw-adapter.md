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
- `contractVersion`: adapter response contract version.
- `request`: studio, query, limit, and search engine.
- `candidates`: compact ranked cards with `name`, `source`, `capabilities`,
  confidence, `why`, and exact `readPath`.
- `selectedSkillTrace`: audit trace for the first candidate, or `null` when
  no clear match exists.

The adapter does not return or read full upstream skill bodies. Agents should
inspect the returned top candidates, choose the relevant one, then read the
exact `SKILL.md` path from `readPath`.

## Contract v0

`openclaw-adapter-contract/v0` is intentionally small:

- responses use `agent-skill-debloater/openclaw-adapter/v1`;
- candidates never include full upstream skill bodies or body-bearing fields;
- default `readPath` values are `pack://<encoded-pack-id>/<skillPath>`;
- absolute `readPath` values are allowed only when the host supplies pack roots
  at install/runtime resolution time;
- `selectedSkillTrace` is present only for a high-confidence top candidate;
- ambiguous or no-match responses keep `selectedSkillTrace: null`;
- selected traces omit candidate prose fields such as `description` and
  `useWhen`, but keep audit fields: skill, source, capabilities, confidence,
  rank, `why`, source URL, and read path.

The fixture scenarios in `docs/openclaw-adapter-contract-fixtures.json`
exercise the required shapes: success, no-match, ambiguous/no-auto-select, and
pack-root-resolved output.

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

Tests and host adapters can call `assertOpenClawAdapterContract(response)` to
fail fast on contract drift. Pass `{ packRootsSupplied: true }` only for
responses generated after explicit pack-root resolution.

## Boundary

This adapter proves the plugin contract only. It does not mutate OpenClaw core,
install customer VM defaults, enforce tool policy, or treat hidden prompts as a
security boundary. Any upstream OpenClaw API, runtime config, PR, merge, or
rollout remains a separate approval gate.
