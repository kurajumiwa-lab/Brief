"""Town-wide commerce: receipt funding, referral exchange and scout work.

This module is the commercial layer over the trust engines that already exist:

  · receipts remain evidence; the receipt engine decides verification
  · merchant credits are a prepaid promotional balance, not customer money
  · referral listings are introductions; a conversion needs independent proof
  · scout work is paid directly by the merchant; the platform records its fee

Nothing in this package holds customer or merchant payout funds. A purchase of
credits or a bounty is an externally settled payment, recorded only after a
payment reference and (for credits) an operator confirmation.
"""
