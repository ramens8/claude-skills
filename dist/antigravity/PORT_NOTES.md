# Antigravity port notes (spike)

Feasibility spike: porting the RampStack `claude-skills` catalog to a Google
Antigravity-compatible distribution via a repeatable build step.

## Catalog at a glance

- Source skill count: **102** (`find skills -name SKILL.md | wc -l`).
- Reference files: **488**, all Markdown, copied byte-for-byte.
- Structure is uniform: every `skills/<name>/` holds exactly `SKILL.md` plus a
  `references/` subtree. References nest at most one level deep (for example
  `references/by-vertical/`, `references/core-archetypes/`); the build copies the
  tree recursively so nesting is preserved.

## Frontmatter normalization

Every source `SKILL.md` carries the same five frontmatter keys:

| key | role | action |
| --- | --- | --- |
| `name` | skill identifier | kept (portable core) |
| `description` | trigger text Antigravity matches on | kept (portable core) |
| `category` | RampStack catalog grouping | moved to sidecar |
| `catalog_summary` | RampStack catalog one-liner | moved to sidecar |
| `display_order` | RampStack catalog sort order | moved to sidecar |

Antigravity discovers a skill from its `---` frontmatter block by matching the
`description`. It does not use the three RampStack presentation keys. Rather than
drop them, the build moves them into a per-skill sidecar at
`references/_claude-frontmatter-extras.yaml` so the port is lossless and fully
reversible. Each emitted `SKILL.md` is left with exactly `name` and
`description`, and the body below the frontmatter is preserved byte-for-byte
(verified across all 102 skills).

`description` values appear in the source both as bare scalars and as
double-quoted strings; the hand parser strips one layer of surrounding quotes
and re-emits with defensive quoting only when the value contains characters a
naive YAML reader could trip on.

## Taxonomy classification: Skills vs Rules vs Workflows

Antigravity splits agent knowledge into three buckets:

- **Skills**: on-demand procedural knowledge in `.agents/skills/`, surfaced by
  description match.
- **Rules**: always-on guardrails injected into every turn.
- **Workflows**: slash-triggered macros.

All **102** catalog entries are on-demand procedural knowledge with
trigger-rich descriptions ("Use this skill whenever..."). Every one maps cleanly
to an Antigravity **Skill**. No entry is authored as an always-on guardrail or a
fixed slash macro, so the port emits **0 Rules** and **0 Workflows**.

Candidates one could promote to Rules later: `design-standards`,
`security-baseline`, and `vertical-site-conventions` read like standing
guardrails a team might want always-on. They are deliberately left as Skills
here. Promoting them changes runtime semantics (always-on injection rather than
on-demand load), which is a product decision, not a mechanical transform, and
would make the spike less cleanly reversible. `seo-audit-orchestration`
orchestrates other skills but is itself invoked on-demand, so it stays a Skill
rather than becoming a Workflow.

## What maps cleanly

- One source skill becomes one `.agents/skills/<name>/` folder.
- Frontmatter reduces to the two fields Antigravity needs, always present and
  non-empty.
- The `references/` subtree, including nested folders, copies verbatim.
- The SKILL.md body and section structure are untouched.

## Known caveats

- The frontmatter parser is intentionally minimal: flat `key: value` scalars
  only. It is sufficient for this catalog (confirmed uniform) but would need
  extension for nested maps, block lists, or folded/multi-line scalars.
- Sidecars live under `references/`, so they travel with the skill and are
  visible to the agent as reference material. They are not read by Antigravity
  for discovery; they exist to keep the RampStack metadata recoverable.
- This is a one-way build (source to dist). There is no reverse step; the
  sidecars make a manual round-trip possible but that is not automated here.
- Skill behavior under Antigravity's runtime was not tested end-to-end; the
  spike validates structural compatibility (discovery shape, frontmatter,
  reference integrity), not live invocation.

## Feasibility

Mechanically straightforward and low-risk: the catalog is uniform, the
transform is a frontmatter trim plus a recursive copy, and all structural
validation passes.
