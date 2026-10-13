---
name: specification-author
description: Explicitly transform work items derived from the project's baseline documents into a versioned specification gate manifest. Use before a TDD cycle to normalize work items, route each to PASS, GHERKIN, DMN, or BOTH, create only the selected formal specifications, persist policy questions with the agent's recommendation, or revise a prior run from a critic report or human decision log. Do not use for work-item planning, source implementation, test code generation, TDD execution, or final approval.
disable-model-invocation: true
argument-hint: "[work-item-id] [--config path] [--manifest path --critic path|--resume decisions-path]"
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write
  - Edit
  - AskUserQuestion
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-cycle.mjs *)
---

# Author specifications

Create or revise specification artifacts without implementing code or approving your own work.

## Load the contract

Read these files before writing artifacts:

- `${CLAUDE_PLUGIN_ROOT}/references/contracts.md`
- `${CLAUDE_PLUGIN_ROOT}/references/routing-and-formats.md`

Read `${CLAUDE_PLUGIN_ROOT}/docs/integration.md` only when resuming questions, revising a run, or preparing the caller for TDD handoff.

## Resolve the input

Do not discover inputs by hand. The resolver reads `.spec-cycle/config.yaml`, fingerprints the baseline
documents, decision records, and work-item list, and derives the run directory.

1. Parse `$ARGUMENTS`. Accept a work-item ID, an optional config path, or revision/resume paths.
2. For a new run, resolve every input first:

   `node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-cycle.mjs resolve-inputs [--project <dir>] [--config <file>] [--task <id>]`

3. Resolve every `notice` yourself before authoring: add or correct `source_refs` in the work item so each
   points into a baseline document or decision record, then re-run the resolver. Notices are traceability
   defects, not human decisions.
4. Stop and resolve every entry in `warnings` with the human before authoring. A work item that already left
   `pending` means the gate is running after implementation; the output would be after-the-fact
   documentation.
5. If `git.ignored` is `false` and a `gitignore_hint` is present, tell the human that run artifacts land in a
   tracked directory and offer the hint. Do not edit `.gitignore` yourself.
6. Run the reported `normalize_command` verbatim, substituting the real plugin root.
7. Do not reuse an output directory that already contains a manifest. `run_dir_status: exists` means this
   exact input set was already started — treat it as a resume or revision, not a new run.

## Author a new run

1. Read the baseline sections named in each work item's `source_refs`, the decision records they cite, and
   any baseline invariants the task touches.
2. Route every normalized task by semantic shape, not priority alone.
3. Record source evidence in `route_reasons` and keep PASS tasks in the manifest.
4. Copy the work item's `acceptance_refs` into the task unchanged. Give every acceptance reference at least
   one obligation that lists it in `acceptance_refs`, and tag the proving scenario with `@<acceptance-id>`.
5. Generate `.feature` files only for GHERKIN/BOTH tasks, under `<run-dir>/specs/revision-0/`.
6. Generate `table-v1` `.decision.yaml` files for DMN/BOTH, run `decision-vectors --table <table> --out <table basename>.vectors.yaml`,
   list the vectors file in `spec_files`, and write one `decision-rule` obligation per rule
   (`source: <table path>#<rule_id>`, `DEFAULT` included). Use `review-only` only when `table-v1` cannot express
   the table, and state the reason in `assumptions`.
7. Keep decision vocabulary identical across BOTH artifacts and identical to the baseline's terms.
8. Separate reversible assumptions from policy ambiguities.
9. For each policy ambiguity, decide what you would do and why, then ask instead of deciding:
   add one atomic question to both the task entry and `questions.yaml`, and set the task to `NEEDS_HUMAN`.
   Give every option a `detail` naming the recorded decision it overturns or relies on and what it costs.
   Always fill `recommended_default` and `recommendation_rationale` with your judgement. Write the two
   copies identically.
10. Otherwise set the task to `READY_FOR_CRITIC`.
11. Set `revision_count: 0` and `max_revisions: 2`.
12. Validate before reporting completion:

    `node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-cycle.mjs validate-author --manifest <run-dir>/author-manifest-revision-0.yaml`

Do not invoke TDD or claim READY. Tell the user to run `/spec-cycle:specification-critic <manifest-path>`.

## Revise from a critic report

1. Verify that the report fingerprint matches the current manifest.
2. Refuse revision if `revision_count` already equals `max_revisions`.
3. Apply only requested outcomes supported by source evidence or recorded human decisions.
4. Never silently invent policy to close a finding; a finding that needs policy becomes a question with a proposal.
5. Preserve reviewed artifacts. Write affected specifications under a new revision path and write a new
   versioned author manifest instead of overwriting the reviewed version.
6. Increment `revision_count` exactly once, update timestamps, and preserve prior manifests and critic reports.
7. Validate the new manifest. Require a new critic pass against its new review-bundle fingerprint.

## Resume from human answers

1. Present unanswered blocking questions through `AskUserQuestion` in a small batch. Put the recommended
   option first and label it "(권장)"; put the rationale in its description and each option's `detail` in its
   own description.
2. Append each answer to `decision-log.yaml`, preserving the original question and `recommended_default`,
   and record `followed_recommendation`, the source, and the timestamp.
3. Revise only affected tasks and increment the revision count once for the batch.
4. Revalidate and require a new critic pass.

## Preserve boundaries

- Do not change work-item status.
- Do not write tests or application code.
- Do not approve the manifest.
- Do not write decision records during a run; promotion happens after the handoff.
- Do not overwrite a reviewed or human-modified specification; create an explicit revision path.
- Do not produce a TDD handoff directly.
