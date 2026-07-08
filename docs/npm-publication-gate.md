# npm Publication Gate

This document is the approval checklist for issue #45. It prepares evidence for
an npm publication decision; it does not authorize publication.

## Gate Rule

Do not run a real `npm publish`, `npm stage publish`, configure registry
credentials, add an `NPM_TOKEN`, add a `NODE_AUTH_TOKEN`, or create an npm
publish workflow unless a maintainer posts an explicit approval comment in issue
`#45` or a linked release issue.

Approval must name:

- package name;
- exact package version;
- exact Git tag and commit to publish;
- whether publication is direct publish or staged publish;
- registry account or trusted publisher owner;
- support owner;
- rollback/deprecation owner;
- evidence packet URL or path.

Suggested approval language:

```text
I approve publishing agent-skill-debloater@<version> from tag <tag> / commit
<sha> to the public npm registry. I understand this approval does not authorize
OpenClaw core changes, customer VM rollout, or fleet rollout.
```

## Candidate Identity

Before publish, record:

- `package.json` name and version;
- `.codex-plugin/plugin.json` version;
- Git tag and commit SHA;
- GitHub release URL;
- package tarball filename;
- npm shasum, integrity, and sha256;
- CI URL for the exact commit;
- package acceptance and clean-room install reports.

Do not publish an untagged working tree. If `main` has moved after the current
release candidate, create and accept a new RC tag before any real publish.

## Required Preflight

Run or verify on the exact candidate commit:

```bash
npm test
npm run eval:routing
npm run eval:rerank
npm run smoke:fresh-agents
node bin/pack-sync check
npm run smoke:openclaw-adapter
npm run acceptance:clean-room
npm run acceptance:package
git diff --check
npm run release:check
npm run pack:dry-run
npm publish --dry-run --ignore-scripts --provenance=false --tag rc
```

The final command is dry-run only. It must be archived as evidence, but it is not
approval to publish.

Review the package contents for secrets, customer data, upstream skill bodies,
generated reports, local paths, credentials, and publish automation surfaces.
The package must include the launch packet and demo transcript.

## npm Account And Provenance Notes

Current npm docs describe direct publishing and staged publishing for public
packages:

- https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages
- https://docs.npmjs.com/creating-and-publishing-scoped-public-packages

For this unscoped package, direct publish requires an npm user account plus
either 2FA or a granular access token with bypass 2FA. npm also documents staged
publishing, where CI can submit a staged package and a maintainer approves it
with 2FA before it becomes public.

Trusted publishing should be preferred over long-lived tokens when the project is
ready for CI-based publishing:

- https://docs.npmjs.com/trusted-publishers

If trusted publishing is used, record the exact npm trusted publisher
configuration, repository, workflow path, allowed action, and provenance status.

## Publish Steps After Approval Only

After explicit approval:

1. Re-confirm clean checkout at the approved tag.
1. Re-run `npm run release:check`.
1. Re-run `npm publish --dry-run --ignore-scripts --provenance=false --tag rc`
   for prerelease versions, or replace `rc` with the explicitly approved
   dist-tag.
1. Publish using the approved method:
   - direct prerelease: `npm publish --tag rc`
   - direct stable: `npm publish`
   - staged: `npm stage publish`
1. Record the npm package URL and package metadata.
1. Run post-publish install proof from a clean directory:

```bash
npm view agent-skill-debloater@<version> dist --json
npm install agent-skill-debloater@<version>
npx agent-skill-debloater openclaw-adapter search design "launch hero cover image"
```

1. Comment on issue #45 with package URL, shasum, integrity, provenance status,
   install proof, and support owner.

## Rollback And Deprecation

npm registry data is immutable: once a `package@version` is published, that same
name and version cannot be reused even if unpublished. npm's unpublish policy is
time- and dependency-sensitive, so prefer deprecation as the normal rollback path
unless npm support and current policy allow unpublish:

- https://docs.npmjs.com/policies/unpublish/

Rollback response:

- publish a fixed new version if the package is salvageable;
- deprecate the bad version with `npm deprecate agent-skill-debloater@<version>
  "<message>"`;
- update the GitHub release notes and issue #45;
- pin docs and install instructions away from the bad version;
- open a support issue with the failure mode and mitigation.

## Proof Boundary

This gate can prove npm publish readiness or, after explicit approval, npm
publication. It does not prove customer VM rollout readiness, OpenClaw core
runtime safety, runtime policy enforcement, customer-data safety, or fleet
deployment safety.
