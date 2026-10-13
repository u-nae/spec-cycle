@task-5
Feature: Task 5 record a learner leaving a live session
  The confirmed leaving behavior is observable while re-entry policy remains unresolved.

  Scenario: Record that an enrolled learner left
    Given an enrolled learner is present in a live session
    When the learner leaves the session
    Then the learner is recorded as having left at that time
