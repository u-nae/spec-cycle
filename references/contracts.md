# Versioned artifact contracts

Read this file before creating or reviewing artifacts. Use schema version `1.0` and repository-relative paths.
`scripts/spec-cycle.mjs` enforces every rule marked "validator" below; the rest are author and critic duties.

## Project config — `.spec-cycle/config.yaml`

```yaml
schema_version: "1.0"
baseline:                     # documents that specifications must be grounded in
  - docs/PRD.md
  - docs/TECH_STACK.md
decision_records: docs/decisions   # directory of *.md decision records, or null
work_items: docs/work-items.yaml
run_root: .spec-cycle/runs
```

Create it once with `spec-cycle.mjs init --baseline docs/PRD.md,docs/TECH_STACK.md --decision-records docs/decisions`.
Every baseline document and the decision-record set are fingerprinted. Changing any of them, or the
work-item list, invalidates every run authored against the previous content (validator).

## Work-item list — `docs/work-items.yaml`

The agent derives work items from the baseline. A work item is the unit that passes the gate and then
enters one TDD cycle.

```yaml
schema_version: "1.0"
items:
  - id: W05                      # [A-Za-z0-9][A-Za-z0-9_-]*; dots are reserved for subtasks
    title: Record a revision for every confirmed configuration change
    description: One sentence of intent.
    details: Scope and boundaries the baseline already fixes.
    test_strategy: How the behaviour will be shown to work.
    status: pending              # pending | in-progress | done | deferred
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

## TDD handoff

```yaml
schema_version: "1.0"
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
decision_log: .spec-cycle/runs/<run-id>/decision-log.yaml
critic_report: .spec-cycle/runs/<run-id>/critic-pass-1.yaml
non_blocking_notes: []
```

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
