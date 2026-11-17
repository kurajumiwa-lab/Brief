# Spotted deals: work in progress

The migrations through `0063_spotted_receipt_link` add the ledger, moderation,
jury and shop settings. The API and Regions/Inbox interfaces are implemented in
this working tree, but this is **not ready for deployment**.

A separate shopper's matching, date-qualified parsed QR can link to a listing.
This is an unverified display signal, not KRA verification or evidence of an
active sale. Linking adds no standing credit. Poster dispute evidence is separate
and does not upgrade the listing. Jury review is hidden, shows redacted evidence,
uses a 2-of-3 decision and fails closed at its deadline. Existing receipt scanning
and rewards have their own separate rules.

## Outstanding launch work

* Integrate the canonical visibility predicate and appropriate spotted cards into
  Explore, Search, Home and `/p/:handle`; currently the new feed is shown in
  Regions only. It is a separate authenticated query, not a unified feed.
* Validate trusted proxy configuration for `request.client.host`: behind an
  unconfigured proxy all users may share a subnet quota, and a deployment must
  not trust arbitrary forwarded headers. Daily hashes and the 24-hour attempt
  ledger are cleaned after two days.
* Expand endpoint tests to cover actual dispute selection, flag weights and
  rolling cooldowns, owner changes during review, deadline sweeps, and concurrent
  requests / lock ordering. The current tests exercise a basic listing lifecycle
  and seeded jury votes, not these adversarial cases.
* Expand frontend tests beyond card labels, seen taps and jury tallies to cover
  creation, filtering, owner controls and jury decisions; run broader regression suites. Shop search is capped at 100 and
  the form currently only uses existing shop records.
* Validate shop-wide re-enabling semantics and privacy/rate-limiting policy with
  the product owner. Re-enabling can surface unexpired eligible listings.

The sweep runs approximately every five minutes through the payment worker.
Run migrations and the scheduler only as part of a reviewed deployment.
