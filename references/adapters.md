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
| `dependencies` (`4`, `"5.2"`) | `T4`, `T5.2` |
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

Documented in Task 11.
