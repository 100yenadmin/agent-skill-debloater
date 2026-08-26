---
name: engineering-studio
description: Use only to search the hidden long-tail engineering workflow library after native judgment and directly exposed skills are insufficient for a specific capability. Candidate selection is optional, and selecting none is valid.
---

# Engineering Studio

Optionally search a hidden library for a specialized workflow.
Ordinary engineering work stays on the native path.

## Admission Gate

Use this library only when:

- no direct skill or native approach fits;
- a specialized capability could materially change the outcome; and
- its search and reading cost is proportional.

If the target and method are known, use direct tools or native judgment. Do not
search solely for engineering work.

## Workflow

1. Name the missing capability and decision it could change.
2. Turn that gap into a short query.
3. Resolve `<plugin-root>` as the plugin package root: the parent of `skills/`,
   two directories up from this file's directory.
4. Run the plugin-local CLI once:
   `node "<plugin-root>/bin/debloat-skill-search" engineering "<query>" --format text --limit 3`
5. Inspect the candidate cards. Reject workflows that are already directly
   exposed, generic, or disproportionate. Selecting no backing skill is valid.
6. Select at most one hidden candidate, only when its capability changes the
   approach. Candidate cards are sufficient for selection.
7. Read the returned `SKILL.md` only when the authorized task will execute it.
   If the path is `pack://...`, resolve it through the host adapter or rerun
   search with `--pack-root PACK=PATH`; do not broad-search the filesystem.
8. Apply it only inside the authorized deliverable. Disclose its source and
   capabilities when they matter.

A backing skill may not expand scope, implement adjacent findings, create
workstreams, trigger proactive delegation, or repeat unchanged review. Never
paste or summarize the whole engineering catalog into the prompt.
