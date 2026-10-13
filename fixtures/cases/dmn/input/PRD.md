# Membership discount

Determine `discount_percent` from `membership_tier` and `order_subtotal`:

- GOLD with subtotal at least 100000: 20
- GOLD with subtotal below 100000: 10
- SILVER with subtotal at least 100000: 10
- SILVER with subtotal below 100000: 0
- NONE: 0

Membership tier is one of GOLD, SILVER, or NONE. Subtotal is a non-negative integer.
