# Launch Packet

AgentSkillDebloater is a plugin-first skill catalog layer for agents that need
large expert skill libraries without loading every skill into the prompt. It
exposes a few compact studio routers and keeps backing skill packs searchable,
hidden by default, and readable only after selection.

## Value Proposition

Large skill packs are useful, but making every skill prompt-visible creates
context bloat and weakens routing. AgentSkillDebloater turns curated packs into
portable catalogs, ranks compact candidate cards, and returns exact backing
`SKILL.md` read paths so agents can load only the instruction they need.

The current release candidate is best described as:

> Plugin-first searchable catalogs for hidden/read-on-demand agent skill packs.

## Who It Is For

- Agent runtime maintainers evaluating skill catalog search before baking
  primitives into their runtime.
- Teams curating default skill packs but trying to avoid prompt bloat.
- Codex/OpenClaw plugin users who want compact studio routers plus auditable
  selected-skill traces.

## Current RC

- Version: `1.0.2-rc.1`
- GitHub prerelease: https://github.com/100yenadmin/agent-skill-debloater/releases/tag/v1.0.2-rc.1
- Tagged artifact acceptance: https://github.com/100yenadmin/agent-skill-debloater/issues/43#issuecomment-4915439176
- Main CI proof: https://github.com/100yenadmin/agent-skill-debloater/actions/runs/28947150244
- GA tracker: https://github.com/100yenadmin/agent-skill-debloater/issues/37

The RC tarball proof recorded:

- Package: `agent-skill-debloater-1.0.2-rc.1.tgz`
- sha256: `26777ff6405780c10e44c6ededb141d27416108a5b82e379c12f046a5c23acae`
- npm shasum: `dbb7544c0cec2a5879b1c9d9b4ddfb5d7a59b647`
- Packed files: 62

## Supported Studios And Seed Packs

| Studio | Primary use | Seed packs |
| --- | --- | --- |
| Design Studio | Visual design, diagrams, covers, UI polish, brand assets | `jimliu/baoyu-skills` |
| Marketing Studio | Positioning, ICP, SEO/content, growth, launches, copy | `coreyhaines31/marketingskills` |
| CEO Studio | Founder judgment, strategy, operating reviews, security posture | `garrytan/gstack` |
| Engineering Studio | Implementation, TDD, debugging, planning, code review | `mattpocock/skills`, `obra/superpowers`, `garrytan/gstack` |

The current compact catalogs contain 104 searchable entries. They do not vendor
or prompt-load full upstream skill bodies.

## Quickstart For RC Evaluation

The package is not published to npm by this workflow. Evaluate the RC from the
GitHub tag:

```bash
git clone https://github.com/100yenadmin/agent-skill-debloater.git
cd agent-skill-debloater
git checkout v1.0.2-rc.1
npm run acceptance:package
npm run acceptance:clean-room
```

Try a catalog search:

```bash
node bin/debloat-skill-search design "launch hero cover image" \
  --engine json \
  --format text \
  --limit 3
```

Try the adapter-shaped audit output:

```bash
node bin/agent-skill-debloater openclaw-adapter search engineering \
  "write a TDD plan for a case-insensitive todo API search filter" \
  --engine json
```

See `docs/demo-router-flow.md` for a small router-to-search-to-read-path
transcript.

## Update Model

Upstream repositories stay intact. AgentSkillDebloater stores manifests,
lockfiles, overlays, compact catalogs, and evals. Maintainers use `pack-sync`
to check provenance and review upstream drift:

```bash
node bin/pack-sync check
node bin/pack-sync diff --pack jimliu/baoyu-skills --to main
```

Scheduled upstream refreshes are diff-only by default. Manual `update-pr` runs
can prepare reviewed draft PRs for one pack at a time.

## Evidence Summary

Release proof for `v1.0.2-rc.1` includes:

- CI on Node 22.13.0 and 26.x.
- `npm test`.
- `skill-routing-evals/v0`.
- `rerank-quality/v0`.
- `fresh-agent-smokes/v0`.
- `pack-sync check`.
- OpenClaw adapter smoke.
- Clean-room install acceptance.
- Package acceptance from a packed artifact.
- Exact-tarball CLI smoke from the tagged `.tgz`.
- `release:check` and `pack:dry-run`.

Voyage reranking remains optional, default-off, and shadow-only. Real-key shadow
evidence did not justify promoting Voyage ordering for this RC.

## Non-Goals And Boundaries

- Hidden/read-on-demand reduces prompt bloat; it is not a security boundary.
- This RC does not publish to npm.
- This RC does not include upstream OpenClaw core changes, pull requests, or
  merges.
- This RC does not prove customer VM rollout readiness, fleet deployment
  safety, runtime policy enforcement, or customer-data safety.
- OpenClaw/customer runtime rollout requires the separate approval gates tracked
  in issues #45 through #48.

## Maintainer Launch Checklist

- Confirm the current GitHub prerelease links to CI, tagged artifact acceptance,
  and the GA tracker.
- Confirm `docs/distribution-readiness.md` still says npm publication is
  deferred unless a maintainer explicitly approves it.
- Confirm no workflow, package script, or release task references `npm publish`,
  `NPM_TOKEN`, `NODE_AUTH_TOKEN`, or registry credentials.
- Run or verify the latest release gate: `npm test`, routing evals, rerank
  evals, fresh-agent smokes, `pack-sync check`, OpenClaw adapter smoke,
  clean-room acceptance, package acceptance, `git diff --check`,
  `release:check`, and `pack:dry-run`.
- If publishing to npm is approved later, complete issue #45 first and record
  the exact package version, registry URL, provenance, rollback plan, and
  support owner. Use `docs/npm-publication-gate.md`.
- If enabling runtime canaries later, complete issues #47 and #48 first with
  Golden/local proof, one opted-in customer canary, rollback, and evidence. Use
  `docs/runtime-canary-plan.md` and `docs/customer-canary-plan.md`.
- If proposing OpenClaw core adoption later, keep curated pack policy in this
  repo and use issue #46 for generic primitive proposals only. Use
  `docs/openclaw-core-primitives.md`.

## Public Message

AgentSkillDebloater is ready for RC evaluation as a plugin-first way to route
large agent skill packs through compact searchable catalogs. It is marketable as
a release candidate with strong local/CI artifact proof, while npm publication
and runtime/customer rollout remain explicit approval gates.
