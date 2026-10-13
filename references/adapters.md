# Adapters

## Intake adapters

The intake adapter decides where the work-item list comes from. `native` (default) means the list in
`docs/work-items.yaml` is authored with the `work-items` skill. `taskmaster` imports a Task Master
`tasks.json` into the same contract as a draft.

### Task Master (`import-taskmaster`)

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-cycle.mjs import-taskmaster [--tasks <file>] [--tag <name>] [--work-items <file>] [--config <file>]
```

Defaults come from `intake.taskmaster.tasks` (default `.taskmaster/tasks/tasks.json`),
`intake.taskmaster.tag` and `work_items` in the config. Tag resolution: `--tag` or config tag, else
`currentTag` in `.taskmaster/state.json`, else `master`. Accepted file shapes: `{ "<tag>": { "tasks": [] } }`,
`{ "tasks": [] }`, and a bare array. If the tag is missing from a tagged file the command fails with
`tag <name> not found; available: <sorted tags>`. Legacy and array shapes ignore the tag for lookup but
still use it in `external_ref`.

| Task Master | Work item |
| --- | --- |
| task `id` (6) | `id: T6`, `external_ref: taskmaster:<tag>:6` |
| subtask `id` (1) under task 6 | nested in `subtasks` with relative `id: "1"` (normalized to `T6.1`), `external_ref: taskmaster:<tag>:6.1` |
| `title`, `description`, `details` | same names |
| `testStrategy` | `test_strategy` |
| `acceptanceCriteria[]` | appended to `details` as `Acceptance criteria (Task Master):` plus a bullet list; `acceptance_refs` stays `[]` |
| `priority` | `high`/`medium`/`low`; anything else becomes `medium` with a warning |
| `status` | `pending`, `in-progress`, `done` as is; `review` becomes `in-progress`; `deferred` and `cancelled` become `deferred`; unknown becomes `pending` with a warning |
| task `dependencies` (`4`, `"5.2"`) | `T4`, `T5.2` |
| subtask `dependencies` (`1`, `"5.2"`) | `"1"` (parent-relative sibling, resolved by the normalizer to `T6.1` under `T6`), `T5.2` (dotted references become absolute) |
| (none) | `source_refs: []` on creation; enrich them afterwards |

### Re-import rules

- Items are matched by `external_ref` (top-level items and subtasks). New ones are appended to `items`.
- Overwritten from Task Master: `title`, `description`, `details`, `test_strategy`, `priority`, `dependencies`.
- Kept as local: `id`, `status`, `source_refs`, `acceptance_refs` and any other local key. When the mapped
  Task Master status differs from the local status, a warning is reported and the local status stays.
- An item whose `external_ref` belongs to this tag but is gone from `tasks.json` is set to `deferred` and
  gets `Deferred: removed from Task Master tag <tag> on import` appended to `details` (once).
- Items without `external_ref` are never touched.
- Comments and formatting in `work-items.yaml` are preserved.
- The result (`tag`, `created`, `updated`, `deferred`, `warnings`) is printed as YAML; ids are full ids
  such as `T6.1`.

## Execution adapters

`execution.adapter` in `.spec-cycle/config.yaml` selects what `/spec-cycle:implement <id>` does after it has
resolved the handoff, rendered `<run_dir>/spec-brief.md` and set the work item to `in-progress`.

Common contract:

- **Input**: the brief (`spec-brief.md`) and the READY handoff (`tdd-handoff.yaml`) of the work item.
- **Output**: the next action the human takes, stated in the report. Adapters hand work over; they do not
  finish it.
- **Prohibitions**: an adapter never writes `done` (only `/spec-cycle:verify` does), never runs another
  command on the human's behalf, and never approves anything (the handoff is already approved by the gate).
- **Closing step**: every adapter ends by pointing at `/spec-cycle:verify <id>`.

| Adapter | Behaviour | Next action for the human |
| --- | --- | --- |
| `superpowers` | Invokes `superpowers:writing-plans` with the brief as the spec and three conventions: brainstorming is not invoked (the handoff is the approved spec); every plan task lists the `obligation_id`s it proves on an `**Obligations:**` line; test names or tags carry the `obligation_id`. After the plan is saved, `check-plan` must report no `missing` obligation before execution starts. The execution-mode question belongs to superpowers and goes to the human unchanged. | Answer superpowers' execution question; after execution, run `/spec-cycle:verify <id>` before `superpowers:finishing-a-development-branch`. |
| `inline` | Summarizes the brief and handoff. Only after the human says go, writes failing tests obligation by obligation in the same session (using `superpowers:test-driven-development` when available), with the `obligation_id` in test names or tags. | Say when to start; then `/spec-cycle:verify <id>`. |
| `command` | Tells the human to invoke `execution.command` with the work item's external id, after reading the brief. The plugin never runs that command. | Run the configured command, then `/spec-cycle:verify <id>`. |

For `superpowers`, the plan `check-plan` reads is the file `superpowers:writing-plans` reports; if it reports none,
`implement` uses the newest `.md` under `execution.plan_dir` (default `docs/superpowers/plans`).

### Fallback rule

If `execution.adapter` is `superpowers` but `detect` reports `superpowers: false`, `implement` falls back to
`inline` instead of failing, says so on the first line of its report, and leaves the config unchanged.

### External-id rule (`command`)

The external id is derived from the work item's `external_ref` (`taskmaster:master:6` gives `6`, so
`/task-cycle 6`). When the item has no `external_ref`, the work item id (for example `W06`) is used.
