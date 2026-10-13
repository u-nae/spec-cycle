# Payment approval

When a pending payment is submitted, request the `payment_approval` decision with `amount`.

- amount from 0 through 100: `AUTO_APPROVE`
- amount greater than 100 through 1000: `MANAGER_REVIEW`
- amount greater than 1000: `REJECT`

`AUTO_APPROVE` changes the payment to `APPROVED`; `MANAGER_REVIEW` changes it to `AWAITING_MANAGER`; `REJECT` changes it to `REJECTED`.
