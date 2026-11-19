"""The referral engine: verified customer acquisition, not link counting.

A code is not a customer and a screenshot is not a purchase. This module owns
three records — a merchant-funded campaign, a referral link a trusted person can
share, and an attribution that stays *pending* until a receipt at the funder's
shop is verified by the receipt engine.

No table here holds a payout balance. When a bounty is owed, the row says so and
the merchant pays the person directly through a licensed rail; marking it paid is
a note on a direct payment, not a movement of platform money.
"""
