# Package Acceptance

`package-acceptance/v0` proves the packaged artifact, not just the source tree.
It is the local release gate for "can this tarball behave like the plugin we
intend to ship?"

```bash
npm run acceptance:package
```

To save a shareable JSON report:

```bash
node src/package-acceptance.mjs check --report artifacts/package-acceptance.json
```

The command:

- runs `npm pack --json` into a temporary directory;
- extracts the produced `.tgz`;
- runs the extracted package CLI against extracted package catalogs;
- verifies compact OpenClaw adapter output for Design and Engineering;
- verifies a Marketing hard-negative returns no match;
- checks required package files and forbidden generated/test artifacts;
- emits a portable JSON report without machine-local temp paths.

The report includes package metadata, checks, compact scenario summaries, and a
proof boundary. It does not include full skill bodies or local temp paths.

## Proof Boundary

Package acceptance proves packaged plugin artifact behavior only. It does not
prove customer VM rollout readiness, OpenClaw core runtime safety, fleet
deployment safety, or npm publication.

