# Undo

A user may undo the most recent confirmed change exactly once. Undo restores the previous value and records the undo in the change history. A second undo request for the same change is rejected as `ALREADY_UNDONE`.

## Acceptance criteria

- A01: Undoing the latest confirmed change restores the previous value, and a repeated undo of that change is rejected as `ALREADY_UNDONE`.
