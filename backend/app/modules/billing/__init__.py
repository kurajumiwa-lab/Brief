"""Subscription billing — Track 2 (v2.15).

Deliberately separate from Track 1 (transaction payments). A payment intent moves
a vendor's money for a trade; a subscription invoice charges a vendor for access
to the platform. Conflating them would put platform revenue and customer float in
one ledger, which is exactly the mistake this module exists to avoid.

Nothing here claims recurring billing is live. ``billing_live()`` is false unless
a real PSP is configured, and every response carries that fact.
"""
