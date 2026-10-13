# Routing and format rules

## Route by semantic shape

- Select `GHERKIN` for observable behavior, state transitions, time windows, ordering, retry,
  cancellation, timeout, permission-dependent behavior, persistence success/failure, or external
  success/failure branches.
- Select `DMN` for combinations of inputs that produce a decision, especially classification,
  eligibility, status, or limits where gaps and overlaps matter.
- Select `BOTH` when a behavior flow invokes an independently reviewable decision. Keep the decision
  name and input/output vocabulary identical across artifacts.
- Select `PASS` when the work item's acceptance guidance already creates a sufficient TDD boundary and
  formalization would only repeat it.

Use priority and dependencies only as risk signals. Cite source evidence in every route reason.

## Gherkin

- Use one keyword language per file. Steps may be written in the baseline's language; keep the
  baseline's domain terms verbatim.
- Tag the Feature with `@task-<id>` (dots become hyphens) or include the task ID in its name.
- Tag scenarios that prove an acceptance criterion with `@<acceptance-id>` (for example `@A04`).
- Test one observable behavior per Scenario.
- Cover the boundary, failure, permission, timing, or retry behavior that justified the route.
- Do not include implementation type, table, or file names unless required by the source.
- Do not invent an unresolved policy; emit a blocking question with a proposal.
- Validate every `.feature` file with the bundled official parser.

## Decision table

When no engine is confirmed, write `<task-id>.decision.yaml` with:

```yaml
schema_version: "1.0"
task_id: W07
decision_id: example_decision
execution_format: review-only
hit_policy: UNIQUE
ordered_rules: false
inputs:
  - name: input_name
    type: string
    allowed_values: [A, B]
    blank_means: any
outputs:
  - name: result
    type: string
    allowed_values: [YES, NO]
rules:
  - rule_id: R1
    when:
      input_name: A
    then:
      result: YES
default_rule: null
gap_analysis: []
overlap_analysis: []
source_locators: []
```

State whether a blank cell means `any` or `missing`; do not leave the meaning implicit. Use an
executable `.dmn` artifact only after confirming an engine and version.

## Assumptions versus questions

- Record reversible, implementation-neutral interpretations as assumptions with their evidence.
- Ask when two reasonable readings change behavior, data meaning, permission, time, state transition,
  overlap, or conflict rules — and attach the agent's recommendation.
- Investigate file locations, names, and formatting conventions instead of asking.
