# Sprint 02: opportunity enquiry and seller management

## Workflow

- Sellers can view their opportunities, including expired and unavailable ones. They can edit the details, mark a live card reserved or unavailable, and explicitly confirm renewal. A renewal resets the seven-day confirmation clock, marks the quote available and can reopen an unavailable card. Editing confirms the displayed details but does not reopen a closed card. Availability changes alone do not refresh the quote timestamp.
- The market directory has an independent town/market filter. Home still displays the latest network-wide cards; the filter is not a saved preference or follow subscription.
- Enquiry re-checks discovery visibility, seller suspension, blocks, expiry and reservation on the server, then opens an existing direct conversation. It returns the current quote for an editable, unsent message draft; only an explicit send creates a chat message. Existing direct conversations are reused and are not unique to a particular opportunity.
- Shared `/p/:handle` links opened while signed out are redirected to the existing `/page/:handle` public card, whose API supports anonymous access. This public card is not the same full portfolio/gallery as the signed-in `/p` view. It remains dependent on the professional-profile feature and backend availability.

## Boundaries

A reservation is a seller claim, not a transaction. We do not verify the quote or guarantee availability; no payment, delivery or trade record is created. The current data model does not record which sent messages belong to which opportunity and does not yet provide conversion metrics. No automatic messages, analytics on private chat, following, notification reminders, delivered-cost comparison or transport matching were added. Public Page access depends on the existing professional-profile endpoint and any production feature flag.

## Rollout

`0085_market_reservation` requires migration `0084_market_opportunities`. Review the production database revision and all pending migrations, back up the database, and apply migrations before deploying the dependent frontend and backend. A local Postgres smoke test covered upgrading from a minimal schema stamped at `0083_merit`, downgrading to `0084_market_opportunities`, and upgrading again; this is not proof that earlier migrations are present in production. No production migration or deployment was performed.
