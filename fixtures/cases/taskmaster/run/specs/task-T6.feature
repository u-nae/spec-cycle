@task-T6
Feature: Task T6 undo the last confirmed change
  A user may undo the most recent confirmed change exactly once.

  @A01
  Scenario: Undo restores the previous value and a repeat is rejected
    Given a user has confirmed a change from "draft" to "final"
    When the user requests undo of that change
    Then the value is restored to "draft"
    And the undo is recorded in the change history
    When the user requests undo of the same change again
    Then the request is rejected with reason "ALREADY_UNDONE"
