"""Event vendor desk: rate cards, structured broadcasts, quotes and bookings.

The module records an agreement between an organiser and a service vendor. It
never holds funds: a quote is a price, an acceptance is a booking, and payment
happens directly between the two parties. Contact details are only exposed once
a quote is accepted.
"""
