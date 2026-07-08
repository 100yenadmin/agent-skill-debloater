# Pack Update Cadence

AgentSkillDebloater tracks upstream skill packs through manifests, lockfiles,
overlays, and generated catalogs. Upstream repositories stay the source of
truth; this repository stores only searchable metadata and provenance.

## Scheduled Drift Reports

The `Upstream pack refresh` workflow runs weekly and can also be run manually in
`diff` mode. It writes `pack-sync diff` JSON artifacts for the five seed packs:

- `jimliu/baoyu-skills`
- `coreyhaines31/marketingskills`
- `garrytan/gstack`
- `obra/superpowers`
- `mattpocock/skills`

Scheduled runs are read-only. They do not call `pack-sync update`, open PRs,
publish packages, change OpenClaw, install defaults, or mutate customer VMs.

## Draft Update PRs

When a maintainer wants to review a specific upstream update, run the workflow
manually with:

- `mode`: `update-pr`
- `pack`: one concrete seed pack, not `all`
- `to`: upstream ref, tag, or SHA
- `resolved_at`: optional `YYYY-MM-DD` override

The manual update path:

1. writes a deterministic provenance diff;
2. runs `pack-sync update` for the selected pack;
3. validates pack metadata;
4. runs routing and rerank evals;
5. runs release/package preflight checks;
6. creates a deterministic update packet and draft PR body;
7. opens a draft PR using only `GITHUB_TOKEN` when lock/catalog files changed.

New upstream skills are not automatically router-visible. A generated update PR
updates lock provenance for allowed upstream skill paths, while catalog exposure
still requires explicit catalog and eval review.

## Review Gates

Generated update packets include:

- pack, from SHA, and to SHA;
- added, removed, moved/renamed, body-changed, missing-hash, and license drift;
- updated lock/catalog files;
- required validation commands;
- a release-note fragment;
- the proof boundary.

License drift is a blocking review gate. Added, removed, moved, renamed, and
body-changed skills require catalog/eval review before a maintainer treats the
update as safe for release.

## Proof Boundary

Pack update cadence proves reviewed lock/catalog provenance changes only. It
does not make new upstream skills router-visible, promote reranking, publish npm
packages, mutate OpenClaw core, install customer defaults, or prove customer
VM/fleet readiness.
