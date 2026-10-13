@task-2
Feature: Task 2 session entry window
  Only enrolled learners may enter during the inclusive entry window.

  Scenario: Enter at the opening boundary
    Given an enrolled learner has a session scheduled at 10:00
    When the learner attempts entry at 09:50
    Then entry is allowed

  Scenario: Enter at the closing boundary
    Given an enrolled learner has a session scheduled at 10:00
    When the learner attempts entry at 10:05
    Then entry is allowed

  Scenario: Deny an attempt before the window
    Given an enrolled learner has a session scheduled at 10:00
    When the learner attempts entry at 09:49
    Then entry is denied with reason "TOO_EARLY"

  Scenario: Deny an attempt after the window
    Given an enrolled learner has a session scheduled at 10:00
    When the learner attempts entry at 10:06
    Then entry is denied with reason "WINDOW_CLOSED"

  Scenario: Deny a non-enrolled user during the window
    Given a non-enrolled user has a session scheduled at 10:00
    When the user attempts entry at 10:00
    Then entry is denied with reason "NOT_ENROLLED"
