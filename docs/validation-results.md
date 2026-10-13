# Validation results

Validated on 2026-10-01 with Claude Code 2.1.286 and Node.js 22.19.0.

## Executed checks

| Check | Result |
| --- | --- |
| `claude plugin validate . --strict` | Passed |
| `claude --plugin-dir . plugin details spec-cycle` | Loaded 0.1.1: 4 skills (run, specification-author, specification-critic, work-items), 1 agent; always-on cost ~707 tokens |
| `npm test` | 43 passed, 0 failed |
| `npm run validate:fixtures` | 6/6 fixtures PASS |
| `npm run metrics` | Completed for all six fixtures |
| Smoke run on a copy of the Fianchetto `docs/` | `init` → `resolve-inputs` → `normalize` succeeded with Korean heading locators |

Tests cover config init and refusal to overwrite, missing-config guidance,
work-item notices versus human warnings, run-id invalidation by baseline and decision-record changes,
subtask flattening, id validation, acceptance coverage, proposal-backed questions (manifest and
critic), decision-log preservation of the proposal, the `invariant-gap` category, and handoff
acceptance coverage.

## Semantic fixtures

The GHERKIN fixture carries a decision record, the GHERKIN and BOTH fixtures carry acceptance
references, and the NEEDS_HUMAN fixture carries a proposal-backed question.

| Fixture | Route | Critic verdict | Purpose |
| --- | --- | --- | --- |
| Simple profile copy change | PASS | READY | Avoid unnecessary formalization |
| Session entry timing and state | GHERKIN | READY | Time boundaries, decision record, acceptance coverage |
| Discount eligibility policy | DMN | READY | Hit policy, gaps, and overlaps |
| Payment flow with approval policy | BOTH | READY | Vocabulary linkage, two acceptance references |
| Conflicting requirements | GHERKIN | NEEDS_HUMAN | Proposal-backed blocking question |
| Missing edge case | GHERKIN | REVISE | Critic detection and bounded revision |

## Not yet validated

- No real gate run (author + independent critic agents) has been executed against the Fianchetto
  baseline. The first real run is the next validation step.
- Effectiveness metrics are fixture-only and say nothing about production value.
