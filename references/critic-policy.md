# Independent critic policy

Review only the relevant baseline excerpts, decision records, normalized source task, author manifest,
generated specifications, and persisted human decisions. Do not accept the author's route explanation as proof.

## Review dimensions

- bidirectional task/spec traceability, including every `source_refs` locator;
- acceptance coverage: each acceptance reference is proven by an obligation that would actually fail if
  the acceptance condition were violated;
- invariants: rules the baseline declares as always true (identity, immutability, atomicity, ordering,
  "never" statements) that the task touches must appear as scenarios or decision rules, not be assumed;
- conformance to decision records — a specification must not silently contradict a recorded decision;
- missing acceptance behavior;
- contradictory scenarios or decision rules;
- missing normal, failure, boundary, permission, time, retry, cancellation, or persistence-failure cases;
- observable and testable Given/When/Then steps;
- decision input domain (including a value for an input that cannot be read or determined), output, hit policy,
  default, gap, and overlap — `check-decision` cannot find a value the author never declared;
- Decision tables: run `check-decision` and cite its output; do not accept `gap_analysis` prose as evidence of completeness.
- vocabulary mismatch between Gherkin and a decision table, and between specifications and the baseline's terms;
- invented business policy;
- excess coupling to implementation details;
- duplicate specification and maintenance risk;
- test obligations suitable for a unit-first TDD cycle.

## Severity

- `critical`: likely to authorize materially wrong or unsafe implementation, or to break a baseline invariant.
- `major`: likely to direct TDD toward incomplete or incorrect behavior.
- `minor`: useful correction that does not invalidate the acceptance boundary.
- `note`: observation with no requested correction.

Use categories `ambiguity`, `contradiction`, `missing-case`, `unverifiable`, `over-specification`,
`traceability`, `syntax`, `policy-gap`, or `invariant-gap`.

## Questions

Raise a blocking question only for a policy ambiguity the sources do not settle. Follow the Question
contract: options with consequences, a `recommended_default`, and a `recommendation_rationale`.
Investigate file locations, names, and implementation conventions instead of asking.

## Verdict

- `READY`: no critical/major finding and no blocking question.
- `REVISE`: source evidence is sufficient for the author to resolve at least one critical/major finding.
- `NEEDS_HUMAN`: at least one blocking decision requires new policy input.
- `BLOCKED_AT_LIMIT`: revision count already equals `max_revisions` and the run is not READY.

Minor findings may remain in a READY report. Never edit an author manifest or specification. Write only the critic report.
