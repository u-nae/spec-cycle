@task-4
Feature: Task 4 submit payment using payment_approval
  A submitted payment exposes the state selected from the payment_approval result.

  Scenario Outline: Transition a submitted payment from its approval decision
    Given a payment is pending with amount <amount>
    When the payment requests payment_approval
    Then payment_approval returns "<decision>"
    And the payment state becomes "<state>"

    Examples:
      | amount | decision         | state            |
      | 100    | AUTO_APPROVE     | APPROVED         |
      | 101    | MANAGER_REVIEW   | AWAITING_MANAGER |
      | 1000   | MANAGER_REVIEW   | AWAITING_MANAGER |
      | 1001   | REJECT           | REJECTED         |
