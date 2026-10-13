@task-5
Feature: Task 5 allow session re-entry for ten minutes
  An enrolled learner may re-enter during the inclusive ten-minute window selected by the recorded decision.

  Scenario: Record that an enrolled learner left
    Given an enrolled learner is present in a live session
    When the learner leaves the session at 10:00:00
    Then the learner is recorded as having left at 10:00:00

  Scenario: Allow re-entry at the inclusive boundary
    Given an enrolled learner left a live session at 10:00:00
    When the learner attempts re-entry at 10:10:00
    Then re-entry is allowed

  Scenario: Deny re-entry after the boundary
    Given an enrolled learner left a live session at 10:00:00
    When the learner attempts re-entry at 10:10:01
    Then re-entry is denied with reason "REENTRY_WINDOW_CLOSED"

