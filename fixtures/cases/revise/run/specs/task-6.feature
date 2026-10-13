@task-6
Feature: Task 6 lock an account after consecutive failures

  Scenario: Lock on the fifth consecutive failed sign-in
    Given an account has four consecutive failed sign-ins
    When another sign-in fails
    Then the account is locked

  Scenario: Reset the failure counter after success
    Given an account has four consecutive failed sign-ins
    When a sign-in succeeds
    Then the consecutive-failure count becomes zero
