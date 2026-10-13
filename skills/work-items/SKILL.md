---
name: work-items
description: Explicitly derive or update the project's gate-ready work-item list (docs/work-items.yaml) from its baseline documents and decision records. Use when starting a project, when the baseline or decision records change, or before running the specification gate on a work item that does not exist yet. Do not use to write specifications, tests, or code.
disable-model-invocation: true
argument-hint: "[--config path] [scope note]"
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write
  - Edit
  - AskUserQuestion
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-cycle.mjs *)
---

# Derive work items

Turn the baseline into a list of work items that can each pass the gate and then enter one TDD cycle.
Read `${CLAUDE_PLUGIN_ROOT}/references/contracts.md` ("Work-item list") first.

## Inputs

1. Read `.spec-cycle/config.yaml`. If it is missing, run
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-cycle.mjs init --baseline <docs> --decision-records <dir>`
   with the project's baseline documents.
2. Read every baseline document and decision record in full. Note the implementation order, scope lists,
   invariants, and acceptance criteria they declare.

## Shape each item

- One item is one observable capability that a single TDD cycle can finish: small enough to review in
  one gate run, large enough to carry at least one acceptance-relevant behavior.
- Follow the baseline's implementation order and express it through `dependencies`.
- Give every item `source_refs` pointing at the exact baseline sections or decision records that justify
  it, and `acceptance_refs` for each acceptance criterion it is responsible for proving.
- Every acceptance criterion in the baseline should be owned by at least one item. List orphans in your
  report instead of inventing items for them.
- Put pure infrastructure (project scaffolding, build settings) in its own items with a `test_strategy`
  that says how it is verified, even if that is a build or a launch check.
- Use stable ids (`W01`, `W02`, ...). Never renumber existing ids; append new ones and mark dropped work
  `deferred` with the reason in `details`.

## Boundaries

- Do not resolve policy ambiguities here. If an item cannot be scoped without a policy decision, keep it,
  note the ambiguity in `details`, and let the gate ask the question with a recommendation.
- Changing the list invalidates gate runs authored against the previous version; mention which runs are
  affected when you edit an item that already has a run.
- Do not change the status of an item that a TDD cycle is working on.

## Finish

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-cycle.mjs resolve-inputs` and fix every notice. Report the
item list as a table (id, title, dependencies, acceptance refs) and any acceptance criteria without an owner.
