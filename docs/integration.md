# Integration and artifact lifecycle

## Project layout

```text
<project>/
├── .spec-cycle/
│   ├── config.yaml                 # baseline documents, decision records, work items, run root
│   └── runs/<run-id>/              # one directory per gate run
├── docs/
│   ├── PRD.md, TECH_STACK.md       # baseline (example)
│   ├── decisions/NNNN-<slug>.md    # decision records
│   └── work-items.yaml             # gate-ready work items
```

## Run layout

```text
.spec-cycle/runs/<run-id>/
├── normalized-tasks.yaml
├── author-manifest-revision-0.yaml
├── questions.yaml
├── decision-log.yaml
├── specs/
│   ├── revision-0/
│   │   ├── task-<id>.feature
│   │   ├── task-<id>.decision.yaml
│   │   └── task-<id>.decision.vectors.yaml   # table-v1 only
│   └── revision-1/
│       └── ...
├── critic-pass-1.yaml
├── critic-pass-2.yaml
├── critic-pass-3.yaml
├── tdd-handoff.yaml
├── spec-brief.md                   # written by implement
└── verification.yaml               # written by verify
```

Create only the files required by the selected routes. Preserve unanswered questions, reviewed
manifests/specifications, and prior critic reports. Write revisions to new paths. Never reuse a READY
report after the review-bundle fingerprint changes.

Recommended `.gitignore` for the project keeps the handoff, accepted specifications, questions, and
decision logs, and drops the intermediate files:

```gitignore
.spec-cycle/runs/*/normalized-tasks.yaml
.spec-cycle/runs/*/author-manifest-*.yaml
.spec-cycle/runs/*/critic-pass-*.yaml
```

## Input resolution

Never discover inputs by hand:

`node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-cycle.mjs resolve-inputs [--project <dir>] [--config <file>] [--task <id>]`

It reports the config, the source snapshot (baseline fingerprints, decision-record fingerprint,
work-item fingerprint), the selected work items, a deterministic `run_id`/`run_dir`, git-tracking status
for the run directory, and a ready-to-run `normalize_command`.

- `warnings` need the human: a selected item already left `pending`.
- `notices` are traceability defects the agent fixes: an item without `source_refs`, or a `source_ref`
  that points outside the baseline and decision records.

## Invocation boundary

Every entry point is invoked by a human; none is model-invocable. The cycle is
`init → work-items → run → implement → verify`:

1. `/spec-cycle:init` detects the environment and writes `.spec-cycle/config.yaml` (never overwrites).
2. `/spec-cycle:work-items` (skill) derives or updates `docs/work-items.yaml` from the baseline.
3. `/spec-cycle:run [work-item-id]` performs the gate: resolve inputs, author, independent critic,
   verdict handling, READY-only handoff, decision-record promotion. It starts no implementation.
4. `/spec-cycle:implement <id>` renders `spec-brief.md`, sets `in-progress` and hands over to the
   configured execution adapter.
5. `/spec-cycle:verify <id>` checks obligation coverage and is the only step that writes `done`.

**Manual** — the skills, for partial or repeated gate steps:

1. `work-items` derives or updates `docs/work-items.yaml` from the baseline.
2. `specification-author` with a work-item ID.
3. `specification-critic` with the generated author manifest path.
4. If the verdict is `REVISE`, invoke the author with both the manifest and critic report.
5. If the verdict is `NEEDS_HUMAN`, present the persisted questions (recommended option first) with
   `AskUserQuestion`, append answers to the decision log, and invoke the author in resume mode.
6. Stop after two revisions. The third critic pass must return `READY` or `BLOCKED_AT_LIMIT`.
7. Build `tdd-handoff.yaml` only from a current `READY` critic report.
8. Promote decisions, then run `/spec-cycle:implement` when the human says so.

## Execution adapters

`execution.adapter` (`superpowers`, `inline`, `command`) decides how `implement` hands the brief over. The
contract of each adapter, the fallback rule and the external-id rule are in
[`references/adapters.md`](../references/adapters.md).

## Critic independence

The critic must not share a context with the author. Two forms carry the same policy from
`references/critic-policy.md`:

| Form | Context isolation | Invoked by |
| --- | --- | --- |
| `specification-critic` skill | `context: fork` | a human |
| `specification-critic-agent` | separate agent context | `/spec-cycle:run` |

Orchestration does not weaken the gate because the enforcement is in `spec-cycle.mjs`, not in
judgement: `validate-critic` rejects a `READY` verdict that retains critical/major findings or
blocking questions, and `build-handoff` refuses any non-`READY` verdict.

## Human question adapter

- Questions are asked only for policy ambiguities, one decision per question.
- Every question carries options with consequences, the agent's `recommended_default`, and a
  `recommendation_rationale`. The validator rejects a question without them.
- In `AskUserQuestion`, the recommended option comes first and is labelled "(권장)".
- The decision log keeps the original question, the original recommendation, the actual answer, and
  whether the human followed the recommendation.
- An answer that changes the manifest invalidates prior critic fingerprints.

## 결정 기록 승격

READY handoff 를 만든 뒤, decision log 의 각 결정을 `decision_records` 디렉터리에 다음 형식으로 남긴다.
번호는 기존 기록의 다음 번호를 쓴다.

```markdown
# NNNN <결정 요약>

- 상태: 확정 (명세 게이트 <run-id>, <question_id>)
- 날짜: <YYYY-MM-DD>

## 맥락
<ambiguity 와 evidence>

## 결정
<answer>. 에이전트 권장안: <recommended_default> (채택 여부: <followed_recommendation>)

## 대안
<채택하지 않은 options 의 label 과 detail>

## 영향
<이 결정으로 바뀌는 명세·작업 항목>
```

새 기록이 생기면 결정 기록 fingerprint 가 바뀌어 이후 run 이 새 run_id 를 받는다. 같은 작업 항목을 다시
게이트에 넣으면 새 결정이 근거로 포함된다.

## TDD boundary

The handoff exposes scenario and decision-rule obligations with their source task IDs, specification
paths, and acceptance coverage. It does not prescribe a test framework. Name or tag each test with the
`obligation_id` it proves so the coverage stays traceable. A non-READY run cannot produce a valid handoff.
