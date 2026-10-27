# Versioned artifact contracts

Read this file before creating or reviewing artifacts. Contracts version 1.1: project config `1.1` (a `1.0` config is still read),
TDD handoff `1.1`, every other artifact `1.0`. Use repository-relative paths.
`scripts/spec-cycle.mjs` enforces every rule marked "validator" below; the rest are author and critic duties.

## Project config — `.spec-cycle/config.yaml`

```yaml
schema_version: "1.1"
baseline:                     # documents that specifications must be grounded in
  - docs/PRD.md
  - docs/TECH_STACK.md
decision_records: docs/decisions   # directory of *.md decision records, or null
work_items: docs/work-items.yaml
run_root: .spec-cycle/runs

intake:
  adapter: native             # native | taskmaster (default native)
  taskmaster:                 # read only when adapter is taskmaster
    tasks: .taskmaster/tasks/tasks.json   # default
    tag: null                 # null: .taskmaster/state.json currentTag, else master

execution:
  adapter: inline             # superpowers | inline | command (default inline)
  command: null               # required when adapter is command, e.g. "/task-cycle"
  plan_dir: docs/superpowers/plans   # default; where implement looks for the superpowers plan

verification:
  test_globs: []              # files searched for obligation ids (default []; verify fails on no match)
  id_pattern: null            # null: literal id match; otherwise a regex string containing {id}
  test_command: null          # optional; verify runs it and records the exit code
```

Create it once with `spec-cycle.mjs init --baseline docs/PRD.md,docs/TECH_STACK.md --decision-records docs/decisions`.
Every section and key below `run_root` is optional and takes the default shown (validator).
Compatibility: a `schema_version: "1.0"` file has no `intake`/`execution`/`verification` sections and is read as
`intake.adapter: native`, `execution.adapter: inline`, `verification.test_globs: []`, so `verify` on a 1.0 config
fails with the empty `test_globs` error.
Every baseline document and the decision-record set are fingerprinted. Changing any of them, or the
work-item list, invalidates every run authored against the previous content (validator).

## Work-item list — `docs/work-items.yaml`

`set-status` (and `verify-obligations --mark-done`) change only the `status` text of the item, or insert one
`status:` line under its `id`; the rest of the file stays byte-identical (folded text, flow lists, comments).
`import-taskmaster` likewise rewrites only the top-level items it changed (fields, new subtasks, deferral)
and appends new items after the last one; unchanged items keep their text. When the existing layout gives no
safe place to splice, it re-serializes the whole file and reports a warning.

The agent derives work items from the baseline. A work item is the unit that passes the gate and then
enters one TDD cycle.

```yaml
schema_version: "1.0"
items:
  - id: W05                      # [A-Za-z0-9][A-Za-z0-9_-]*; dots are reserved for subtasks
    external_ref: taskmaster:master:5   # optional, <adapter>:<tag>:<id>; written by import-taskmaster
    title: Record a revision for every confirmed configuration change
    description: One sentence of intent.
    details: Scope and boundaries the baseline already fixes.
    test_strategy: How the behaviour will be shown to work.
    status: pending              # pending | in-progress | done | deferred; omitted means pending
    priority: high               # high | medium | low
    dependencies: [W04]
    source_refs:                 # baseline or decision-record locators that justify the item
      - docs/PRD.md#7-기록-정책과-저장-안정성
      - docs/decisions/0003-snapshot-paths.md
    acceptance_refs: [A04, A13]  # acceptance criteria the item must satisfy
    subtasks: []                 # optional, same shape; ids become W05.1, W05.2, ...
```

Every work item needs a non-empty `source_refs` that points into a baseline document or decision
record; `resolve-inputs` reports violations as `notices` for the agent to fix before authoring.

## Normalized input

```yaml
schema_version: "1.0"
source:
  baseline:
    - path: docs/PRD.md
      fingerprint: <sha256>
  decision_records:
    path: docs/decisions        # or null
    fingerprint: <sha256 over the sorted set of record paths and contents>
  work_items_artifact: docs/work-items.yaml
  work_items_fingerprint: <sha256>
normalization_warnings: []
tasks:
  - task_id: W05
    parent_task_id: null
    title: Example
    description: Example
    details: Example
    test_strategy: Example
    status: pending
    priority: high
    dependencies: []
    source_refs: [docs/PRD.md#7-기록-정책과-저장-안정성]
    acceptance_refs: [A04, A13]
    source_locator: work-items[id=W05]
```

## Author manifest

Quote any value that contains ` #`. YAML reads the rest of a plain value after ` #` as a comment, so
`validate-author` rejects a plain value followed by a same-line comment (validator).

```yaml
schema_version: "1.0"
run_id: <stable-id>
generated_at: <ISO-8601>
revision_count: 0
max_revisions: 2
source:
  <identical to the normalized source block>
  normalized_artifact: .spec-cycle/runs/<run-id>/normalized-tasks.yaml
tasks:
  - task_id: W05
    title: Example
    source_locator: work-items[id=W05]
    observed_attributes:
      priority: high
      dependencies: []
    acceptance_refs: [A04, A13]  # must equal the work item (validator)
    route: GHERKIN
    route_confidence: high
    route_reasons: []
    risk_signals: []
    assumptions: []
    spec_files: []
    test_obligations:
      - obligation_id: W05-rename-records-revision
        task_id: W05
        kind: scenario
        description: Observable behaviour to turn into a test
        source: .spec-cycle/runs/<run-id>/specs/revision-0/task-W05.feature#scenario-name
        acceptance_refs: [A04]   # optional; which acceptance criteria this obligation proves
    questions: []
    author_status: READY_FOR_CRITIC
```

Use `NEEDS_HUMAN` only when the task has at least one unanswered blocking question (validator).

## Question

A question is asked only for a **policy ambiguity**: two reasonable readings of the sources that change
observable behaviour, data meaning, permission, time, or boundary rules. Every question carries the
agent's own judgement — the human decides, but never from a blank page.

```yaml
question_id: Q-W05-1
task_id: W05
blocking: true
ambiguity: What is undecided, and why the sources do not settle it
evidence: docs/PRD.md#locator
question: One decision only
options:
  - id: A
    label: Short name of the choice
    detail: Which recorded decision this choice overturns or relies on, and what it costs
  - id: B
    label: ...
    detail: ...
recommended_default: A        # required; must be one of the option ids
recommendation_rationale: Why the agent recommends A over the others, citing the evidence
answer: null
answer_source: null
```

Validator rules: at least two options; every option has `id`, `label`, `detail`; option ids are unique;
`recommended_default` is required and names an option; `recommendation_rationale` is required. If the
sources truly do not lean, the agent still recommends — the option with the smallest blast radius or the
easiest reversal — and says so in the rationale.

The manifest copy of a question must be identical to the `questions.yaml` entry. Reading either file
alone must support the same decision.

## Decision log

```yaml
schema_version: "1.0"
run_id: <same-run-id>
decisions:
  - question_id: Q-W05-1
    task_id: W05
    question: Original question
    recommended_default: A           # preserved verbatim from the question (validator)
    answer: User answer
    followed_recommendation: true    # validator: boolean
    answer_source: AskUserQuestion
    answered_at: <ISO-8601>
```

After the run reaches `READY` and the handoff exists, promote each human decision to a decision
record (see `docs/integration.md`). Promotion happens after the handoff because adding a record changes
the decision-record fingerprint.

## Critic report

```yaml
schema_version: "1.0"
run_id: <same-run-id>
critic_pass: 1
reviewed_manifest: .spec-cycle/runs/<run-id>/author-manifest-revision-0.yaml
reviewed_fingerprint: <sha256-of-manifest-and-referenced-specifications>
verdict: READY
findings: []
questions: []          # same Question contract, proposal included
summary:
  critical_count: 0
  major_count: 0
  minor_count: 0
  note_count: 0
```

Each finding contains `finding_id`, `task_id`, `severity`, `category`, `evidence`, `explanation`,
`requested_change`, and `requires_human`.

## Decision table — `execution_format: table-v1`

`<task-id>.decision.yaml` is machine-evaluated by `lib/decision.mjs`. `review-only` tables stay valid.

```yaml
schema_version: "1.0"
task_id: W06
decision_id: bookmark_failure_cause
execution_format: table-v1      # or review-only
hit_policy: FIRST               # UNIQUE | FIRST | ANY (PRIORITY, COLLECT are rejected)
ordered_rules: true             # true for FIRST; false for UNIQUE and ANY
inputs:
  - name: volume_state
    type: string
    allowed_values: [mounted, unmounted, unknown]
    blank_means: any            # any | missing
outputs:
  - name: cause
    type: string
    allowed_values: [volume_unavailable, missing, access_denied, check_failed]
rules:
  - rule_id: R1
    when: {volume_state: unmounted}   # cell: literal | [literals] | any | omitted (per blank_means)
    then: {cause: volume_unavailable}
default_rule: null              # or { then: {...} }; its cells are rule DEFAULT
gap_analysis: []                # annotations on the computed result; may be empty
overlap_analysis: []            # FIRST: must be non-empty when overlaps are computed (state the intent)
source_locators: [...]
```

Numeric inputs declare interval labels as `allowed_values` (`["< 100000", ">= 100000"]`) and use the same
labels in cells; the evaluator treats labels as an enum. Whether the intervals tile the number line is a
critic dimension, not a computed one. The cell count may not exceed 10,000.

## Decision vectors — `<task-id>.decision.vectors.yaml`

Generated beside the table by `decision-vectors`; list it in the task's `spec_files` so it joins the review
fingerprint.

```yaml
schema_version: "1.0"
decision_id: bookmark_failure_cause
table: <the table path exactly as listed in spec_files>   # validate-author rejects an absolute or different path
table_fingerprint: <sha256 of the table file>   # validate-author rejects a mismatch as stale
cells_total: 9
rules:
  - rule_id: R1
    obligation_id: W06-bookmark_failure_cause-R1  # <task>-<decision_id>-<rule_id>
    wins:                       # cells whose final output this rule decides
      - inputs: {volume_state: unmounted}
        expected: {cause: volume_unavailable}
    shadowed: []                # FIRST: matched cells lost to an earlier rule (informational)
gaps: []                        # must be empty unless default_rule covers them
overlaps: []                    # UNIQUE: must be empty
```

## Per-rule obligations

A task with a table-v1 table needs one obligation per evaluated rule, including `DEFAULT` when
`default_rule` is present. `review-only` tables keep one table-level obligation.

```yaml
test_obligations:
  - obligation_id: W06-bookmark_failure_cause-R1
    task_id: W06
    kind: decision-rule
    description: <one line>
    source: <table path>#R1     # exactly <path as listed in spec_files>#<rule_id>
```

## TDD handoff

```yaml
schema_version: "1.1"
run_id: <same-run-id>
verdict: READY
source: <manifest source block>
source_tasks:
  - task_id: W05
    title: Example
    route: GHERKIN
    acceptance_refs: [A04, A13]
accepted_specifications: []
test_obligations: []
acceptance_coverage:            # acceptance id -> obligation ids that prove it
  A04: [W05-rename-records-revision]
decision_vectors:               # one entry per table-v1 vectors file; [] when none
  - decision_id: bookmark_failure_cause
    rules: []                   # copied from the vectors artifact
decision_log: .spec-cycle/runs/<run-id>/decision-log.yaml
critic_report: .spec-cycle/runs/<run-id>/critic-pass-1.yaml
non_blocking_notes: []
```

## Spec brief — `<run_dir>/spec-brief.md`

`render-brief --handoff <file> --out <file>` renders the brief deterministically from the handoff: the same
handoff gives a byte-identical brief, and an existing brief with different content is never overwritten
(validator). Headings, in order:

1. `## 1. 작업 항목` — id, title, route, acceptance refs, baseline paths with fingerprints, `run_id`
2. `## 2. 승인된 명세` — full `.feature` text; decision tables as a Markdown table plus the computed cell map
3. `## 3. Test obligations` — obligation_id, kind, description, acceptance_refs, source
4. `## 4. 결정 벡터` — per rule: inputs and expected outputs (empty for a 1.0 handoff)
5. `## 5. 결정` — the decision log and promoted decision-record paths
6. `## 6. Non-blocking notes`
7. `## 7. 검증 계약` — the sentence: "모든 테스트의 이름 또는 태그에 그 테스트가 증명하는 obligation_id를
   포함한다. /spec-cycle:verify 가 이 문자열을 찾는다."

## Plan check — `check-plan` stdout

`check-plan --plan <file> --handoff <file>` reports which handoff `obligation_id`s are absent from the plan text.
An id counts only as a whole token, so `W06-x-10` does not cover `W06-x` (validator).

```yaml
total: 7                  # obligations in the handoff
missing: [W06-bookmark_failure_cause-R4]
```

Exit code 1 when `missing` is non-empty, and when the handoff has no test obligations (validator).

## Verification report — `<run_dir>/verification.yaml`

Written by `verify-obligations --task <id> [--test-command <cmd> --test-exit-code <n>] [--human-confirmed <true|false>] [--mark-done]`
on every run, replacing the previous report.

```yaml
schema_version: "1.0"
run_id: t-w06-c0dec005
task_id: W06
checked_at: <ISO-8601>
test_globs: [Tests/**/*.swift]
obligations:
  - obligation_id: W06-create-bookmark
    covered: true
    locations: [Tests/Platform/BookmarkTests.swift:42]   # sorted file:line matches
  - obligation_id: W06-bookmark_failure_cause-R4
    covered: false
    locations: []
uncovered_count: 1
test_command:             # from --test-command/--test-exit-code, or null
  command: scripts/vm-verify.sh
  exit_code: 0
human_confirmed_tests: null   # from --human-confirmed true|false, or null
status_written: null      # done only when --mark-done ran with uncovered_count 0 and tests passed or confirmed
```

Coverage is an existence check: an obligation is covered when its id (or `verification.id_pattern` with the
id substituted) appears in a file matched by `verification.test_globs`. `--mark-done` writes `done` to the
work-item list only when `uncovered_count` is 0 and the tests passed (`exit_code` 0) or a human confirmed them
(validator). Nothing in the report is edited by hand; the test evidence travels as flags.

## Status snapshot — `.spec-cycle/status.json`

A machine-readable view of the whole project for tools that watch the gate (a Claude Code mod, a status
line). Written by `status --json --write`, and rewritten as the last step of every state-changing
subcommand: `init`, `import-taskmaster`, `resolve-inputs`, `normalize`, `validate-author`, `validate-critic`,
`validate-decisions`, `build-handoff`, `render-brief`, `set-status`, `verify-obligations`. Read-only
subcommands (`detect`, `resolve-handoff`, `fingerprint`, `check-decision`, `decision-vectors`, `check-plan`,
`status` without `--write`, `validate-fixtures`, `metrics`) never write it. `status --json` prints the same
document to stdout without writing; `status` without flags prints the YAML table exactly as before.

```jsonc
{
  "schema_version": "1.0",
  "generated_at": "2026-10-27T06:00:00.000Z",
  "generated_by": "spec-cycle@0.4.0 build-handoff",   // plugin version and the subcommand that wrote it
  "config": { "path": ".spec-cycle/config.yaml", "intake": "native", "execution": "superpowers",
              "run_root": ".spec-cycle/runs", "work_items": "docs/work-items.yaml" },
  "inputs": [                                           // cheap freshness check: compare with the files' mtimes
    { "path": "docs/PRD.md", "mtime_ms": 1791953472870 },
    { "path": "docs/work-items.yaml", "mtime_ms": 1791953472871 },
    { "path": "docs/decisions", "mtime_ms": 1791953472872, "kind": "dir-max" }   // newest mtime under the directory
  ],
  "items": [
    {
      "id": "W05", "parent_id": null, "title": "…",
      "status": "pending",                              // pending | in-progress | done | deferred (as written in the list)
      "priority": "high", "dependencies": ["W04"], "dependencies_done": true, "external_ref": null,
      "run": {                                          // the newest run that covers the item, as `status` picks it; null without one
        "id": "t-w05-c0dec005", "dir": ".spec-cycle/runs/t-w05-c0dec005", "updated_at": "2026-10-27T05:58:00.000Z",
        "revision_count": 1, "max_revisions": 2,        // from the newest author manifest; null when it has none
        "critic_passes": 2,
        "verdict": "NEEDS_HUMAN",                       // newest critic report; null before the first review
        "findings": { "critical": 0, "major": 1, "minor": 2, "note": 0 },
        "open_questions": [                             // unanswered questions of this item only (see below)
          { "question_id": "Q-W05-1", "question": "…", "blocking": true,
            "recommended_default": "A", "recommended_label": "…", "recommendation_rationale": "…" }
        ],
        "route": "GHERKIN",
        "artifacts": {                                  // repository-relative; null or [] when absent
          "handoff": ".spec-cycle/runs/…/tdd-handoff.yaml", "brief": null, "verification": null,
          "decision_log": ".spec-cycle/runs/…/decision-log.yaml",
          "critic_reports": [".spec-cycle/runs/…/critic-pass-1.yaml", ".spec-cycle/runs/…/critic-pass-2.yaml"],
          "spec_files": [".spec-cycle/runs/…/specs/revision-1/task-W05.feature"]
        }
      },
      "handoff": { "usable": true, "errors": [], "warnings": [], "obligations_total": 7 },   // null unless the run has a handoff
      "verification": { "covered": 5, "total": 7, "checked_at": "…", "tests": "passed", "status_written": null }   // null without verification.yaml
    }
  ]
}
```

Rules (validator):

- `items` follow the order of the work-item list; a subtask (`W05.1`) comes right after its parent. An empty
  list yields `items: []` (the YAML `status` still fails on it).
- `handoff.usable`, `errors` and `warnings` are `resolve-handoff`'s own result; `obligations_total` counts the
  handoff's obligations whose `task_id` is the item (all of them when they carry none).
- `open_questions` come from `questions.yaml` when the run has one, else from the newest critic report; a
  question is open when `answer` is null and the decision log has no entry for it. `recommended_label` is the
  label of the `recommended_default` option.
- `verification.tests` is `passed` (`test_command.exit_code` 0), `failed` (non-zero), `confirmed`
  (`human_confirmed_tests: true` with no command), else `unknown`.
- `inputs` lists only files that exist; `kind: dir-max` marks a directory whose `mtime_ms` is the newest
  mtime of the directory and everything under it.
- The file is written to a temporary name and renamed, so a reader never sees a partial document. A write
  failure leaves the subcommand's exit code and stdout as they were and prints one line to stderr:
  `spec-cycle: status snapshot not written (<reason>)`. A subcommand that takes an artifact path instead of a
  project (`validate-*`, `build-handoff`, `render-brief`) finds the project by the nearest ancestor holding
  `.spec-cycle/config.yaml`; with none, nothing is written and nothing is said.
- `status.json` is a local derivative (its mtimes differ per machine): ignore it in git. `resolve-inputs`
  lists it in `gitignore_hint`.
- The snapshot adds no judgement: every field is read from the files above or computed by the function the
  corresponding subcommand uses. Readers must not treat it as a source of truth separate from those files.

## Invariants

- Keep every source task in the author manifest, including PASS tasks.
- Give PASS tasks at least one obligation even though they have no formal spec file.
- Trace every specification and test obligation to a source task ID.
- Cover every acceptance reference of a task with at least one obligation; cite none it does not list.
- Treat PASS as low incremental formalization value, not low importance.
- Preserve human answers and the agent's original proposal separately from the question.
- Fingerprint the exact current author manifest and all referenced specification files before critic review.
- Invalidate the run when a baseline document, the decision-record set, or the work-item list changes.
- Reject stale critic reports.
- Reject READY when critical or major findings or blocking questions remain.
- Reject REVISE or NEEDS_HUMAN at the final pass; use BLOCKED_AT_LIMIT.
- Reject TDD handoff generation unless the current report is READY.
