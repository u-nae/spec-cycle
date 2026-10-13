---
name: specification-critic
description: Explicitly and independently review a specification-author manifest and its source-linked Gherkin or review-only decision tables before TDD. Use after specification-author or after each bounded revision to emit an evidence-backed READY, REVISE, NEEDS_HUMAN, or BLOCKED_AT_LIMIT report. Do not use to author, edit, silently repair, implement, test, or approve stale specifications.
disable-model-invocation: true
argument-hint: "<author-manifest.yaml>"
context: fork
background: false
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-cycle.mjs *)
disallowed-tools:
  - Edit
---

# Criticize specifications independently

Review the artifact in `$ARGUMENTS` in this isolated context. Do not rely on author conversation or conclusions.

## Load the policy

Read:

- `${CLAUDE_PLUGIN_ROOT}/references/contracts.md`
- `${CLAUDE_PLUGIN_ROOT}/references/critic-policy.md`
- `${CLAUDE_PLUGIN_ROOT}/references/routing-and-formats.md`

## Establish review inputs

1. Require exactly one current author manifest path.
2. Validate the author artifact:

   `node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-cycle.mjs validate-author --manifest <manifest>`

   For each `table-v1` decision table also run `node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-cycle.mjs check-decision --table <table>`
   and base completeness findings on its gaps, overlaps, and per-rule cells.

3. Read the baseline sections and decision records named in each task's `source_refs`, the baseline
   invariants the task touches, the normalized tasks, the manifest, every referenced specification file, and
   the decision log. Read the documents listed in `source.baseline` — not documents you would have chosen.
4. Compute the exact current review-bundle fingerprint:

   `node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-cycle.mjs fingerprint --manifest <manifest>`

5. Set `critic_pass` to `revision_count + 1`.

## Review

Apply every dimension in `critic-policy.md`. Verify routing value as well as specification quality. Treat
style preferences as minor or note-level only.

For every issue, cite a source or specification locator and request an outcome. Do not supply a silent
edit. Ask one blocking policy decision per question, and attach your recommendation and its rationale.

## Decide

Apply the verdict table exactly:

- READY when no critical/major finding or blocking question remains.
- REVISE when source evidence is sufficient for correction.
- NEEDS_HUMAN when new policy input is required.
- BLOCKED_AT_LIMIT when the run is not READY and `revision_count == max_revisions`.

Count findings by severity in `summary`. A READY report may retain minor findings.

## Write and validate the report

Write `critic-pass-<critic_pass>.yaml` beside the manifest. Include the exact review-bundle SHA-256 in
`reviewed_fingerprint`, then run:

`node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-cycle.mjs validate-critic --report <report> --manifest <manifest>`

If READY, state that the deterministic handoff adapter may run. Do not generate the handoff yourself.

## Preserve independence

- Never edit `.feature`, `.decision.yaml`, the author manifest, questions, or decisions.
- Never accept the author's self-assessment as evidence.
- Never convert limit exhaustion into success.
- Never invoke TDD or change work-item status.
