# Router Flow Demo

This transcript shows the intended AgentSkillDebloater loop:

1. The visible studio router stays tiny.
2. The agent searches the matching hidden catalog.
3. Search returns compact candidates with capability labels and exact `SKILL.md`
   read paths.
4. The agent reads only the selected backing skill.

The demo uses deterministic JSON search so output is stable across Node builds:

```bash
debloat-skill-search design "launch hero cover image" \
  --engine json \
  --format json \
  --limit 3
```

Expected shape:

```json
{
  "studio": "design",
  "query": "launch hero cover image",
  "results": [
    {
      "name": "baoyu-cover-image",
      "source": "jimliu/baoyu-skills",
      "confidenceLabel": "high",
      "capabilities": ["file-write"],
      "readPath": "pack://jimliu%2Fbaoyu-skills/skills/baoyu-cover-image/SKILL.md"
    }
  ]
}
```

For an OpenClaw/Codex adapter-shaped audit trace:

```bash
agent-skill-debloater openclaw-adapter search engineering \
  "write a TDD plan for a case-insensitive todo API search filter" \
  --engine json
```

Expected selected-skill trace:

```json
{
  "adapter": "agent-skill-debloater/openclaw-adapter/v1",
  "selectedSkillTrace": {
    "name": "tdd",
    "source": "mattpocock/skills",
    "readPath": "pack://mattpocock%2Fskills/skills/engineering/tdd/SKILL.md"
  }
}
```

Hard negatives should return no skill instead of reaching across studios:

```bash
debloat-skill-search marketing "repair a kubernetes storage class bug" \
  --engine json \
  --format json
```

Expected shape:

```json
{
  "studio": "marketing",
  "results": []
}
```

## Demo Boundary

This demo proves local catalog routing and compact result contracts only. It does
not prove customer VM rollout readiness, OpenClaw core runtime safety, fleet
deployment safety, npm publication, or security policy enforcement. Hidden
prompt visibility reduces prompt bloat; it is not a security boundary.
