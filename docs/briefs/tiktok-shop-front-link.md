# Why a TikTok seller should use Brief as the shop-front link (v2.18)

> **The question, in the words it was asked:** *"Why should a TikTok seller use
> Brief as the website link for their shop front — what does TikTok not provide?
> What is missing, and how do we sell it?"*
>
> **The answer in one line:** TikTok gives a seller an audience and a comment
> section. It does not give them a shelf, a price list a buyer can read without
> watching a video, a record of who bought what, or a name in a network of other
> businesses. Brief is that second half — and the seller enters it by pointing
> their bio link at a page that already exists, for free.
>
> **What we must never claim:** that we can host their TikTok audience, replace
> their TikTok account, or sell them their own followers back. We cannot, and
> saying so would be the sort of promise this product has consistently refused
> to make.

---

## 1. What TikTok actually does, and where it stops

TikTok is a discovery engine. A wholesaler films a stack of rice bags, writes
`50kg @ 5,800` on the bags, and the video reaches people who would never have
walked into that shop. That is genuinely valuable, and it is why these sellers
are already there.

It is also where the product stops. Everything after "a buyer saw the video" is
carried by comment threads, direct messages and a WhatsApp number pasted into a
bio. Concretely, the seller cannot:

| The buyer's question | What the seller does today | What is missing |
|---|---|---|
| *What do you have, and at what price?* | Reels one at a time, prices written on sacks in marker pen | A list that can be scanned, sorted and compared in ten seconds |
| *Is that price still today's?* | Re-record, re-post, hope the old video is buried | A dated price the seller (or an operator) can update without filming |
| *Can I order 20 bales, not 1?* | DM "how much for 20?", wait, negotiate | A minimum order quantity and a unit, written down |
| *Who else sells this, cheaper?* | Nothing — the buyer scrolls | A market view, which is what we sell to the *buyer* side |
| *Can I find you again next month?* | Follow and hope the algorithm shows it | An addressable shop page with a stable link |
| *Do you actually deliver?* | Testimonial comments | A record of completed trades, not testimonials |
| *Is this a real business?* | Profile picture and a phone number | Verification state, categories, location, trading history |

Note what is **not** in that table: reach, engagement, advertising, analytics of
views. TikTok does those well. The gap is *commerce plumbing* — the boring,
unphotogenic half of selling that a feed cannot hold.

**The precise product claim, therefore:**

> TikTok gets you seen. Brief is where the buyer who saw you checks the price,
> the minimum order and whether you are real — and where you keep a record of
> having traded, which is the thing you will need when you want credit.

---

## 2. Why the "link in bio" is the wedge

The seller already has a link-in-bio slot, already has a phone, already has a
customer asking "how much?". The friction we must not add:

- **No account required to be listed.** A seller who is not on Brief still gets
  a shop page, minted as a virtual identity (`~khetia`) from their public
  advertising. It costs us nothing to create, it cannot sign in, and it gives
  their prices a home.
- **No app install.** The link opens a page.
- **No re-recording.** The photographs they already posted become the shelf.
- **Claiming is a phone check, not a signup funnel.** Whoever can prove the
  number on the sign takes over the page and their prices come with it.

That is the whole funnel: *a link that is better than a WhatsApp number*, and a
claim that is easier than registering anywhere.

---

## 3. What Brief has that a bio link does not

1. **A readable shelf.** Price, unit, minimum order, category, market, photo.
   One page, current, no video to scrub through.
2. **A network, not an audience.** Other businesses that source what this seller
   stocks. TikTok's algorithm shows the seller to consumers; Brief shows the
   seller to the shop that wants 40 bales.
3. **A trading record.** Movements between businesses, confirmations, fulfilment.
   This is the collateral for the credit conversation nobody else is having with
   a Kikomba wholesaler.
4. **A market view.** The seller can see what the market is charging — including
   prices we collected from public advertising, which is the dataset described
   in §5.
5. **Contacts that survive the video.** A store page keeps the phone, the
   location, the categories and the gallery in one place, findable by search.

What it does **not** have, and must not pretend to: reach, entertainment,
discovery at TikTok's scale, or the TikTok checkout rails. We are the second
half of the funnel, not a competitor for the first.

---

## 4. How it is sold

**Speak to the trade, not to the creator.** The buyer of this is a wholesaler
with a shop, a stack of bags and a phone. The pitch is one sentence long:

> "Your TikTok already gets you seen. This link shows the price, the minimum
> order and that you're real — and it's free to set up. If someone tries to
> claim your shop, they have to prove they have your number, and that's you."

Then the paid step, and it is deliberately *not* charged before payment
processing is verified (see `docs/briefs/storefront-catalogue-and-pricing.md`):
the **Business software** line — customer and sales records, stock, orders — is
the operational product. Market-data access is the *member/partner* ladder: prices
for anyone signed in, seller contacts for a partner plan. Nothing is charged from
within the app; an upgrade routes to `/storefront?desk=business_software` and says
plainly that no money moves on that screen.

**Pricing posture.** Free listing and free claiming. The seller pays for records
and for the partner view of the market — the two things that become valuable only
once they are actually trading on the network.

---

## 5. The dataset, and why we are allowed to carry it

Brief's market data is built from **public advertising**: shop signs, price
boards, and public posts that a seller put in front of the world in order to be
found. A photograph of a price on a sack is an offer to the public, and we carry
**prices**, not accounts.

That distinction is the rule the code enforces:

- A row records a **price, product, size, category, market and date**. It does
  not record a buyer, a customer list, a conversation or a follower.
- A seller with no Brief account appears as a **virtual identity** that cannot
  authenticate. Their phone number is shown only to a **partner** plan; a member
  sees the price with the seller withheld (`seller_hidden: true`).
- **Nothing enters the dataset unreviewed.** Every extracted row is a
  suggestion that an operations person keeps or throws away. The extractor never
  matches against the catalogue, never corrects the OCR's spelling, and drops any
  line without a price.
- Every row is labelled as *a price seen in public advertising on a date* — not a
  quotation, not stock on hand. The screen says so above the first row.

### Consent, and the Kenya Data Protection Act

**This paragraph is a compliance position that needs professional verification
before the product is sold on it.** The engineering rules above are what the code
does; whether they satisfy a regulator is a lawyer's answer, not ours.

- **Personal data in scope.** A seller's phone number, and a seller's name
  attached to their shop, are personal data under the Kenya Data Protection Act,
  2019. A photograph of a person is personal data as well; a photograph of a price
  board is not.
- **Lawful basis.** The defensible basis for *public advertising* is the seller's
  own act of publishing in order to be contacted — but that is a position to be
  confirmed, not assumed. Where a seller is contacted directly, the basis is
  their consent, recorded as a claim of their virtual identity.
- **What we publish vs. what we hold.** Prices may be published. Contact details
  are shown only on a partner plan, only for businesses that published them
  themselves, and only until the seller asks otherwise.
- **Rights we must be able to honour.** Access, correction, and erasure of a
  seller's own row. The claim flow is the mechanism: a seller who proves the phone
  number owns the page and can take it down. **A takedown path that does not
  depend on having an account must exist before we scale collection** — that is an
  open item, not a shipped feature.
- **Retention.** A price is a fact with a date. Rows age; contact details should
  not be kept indefinitely without a trading relationship.
- **Cross-border.** Hosting and inference must be described honestly in the
  privacy notice, including any OCR processing that happens outside Kenya.

**What we will not do:** scrape private messages or closed groups; republish a
person's image as marketing; imply a seller endorses Brief when they have never
heard of us; sell contact details to anyone outside the partner tier.

---

## 6. What is missing before this is a real offer

Listed so it is not quietly forgotten:

1. **A takedown path that works without an account** (see §5). Today a seller
   can claim their presence; there is no self-service removal for a seller who
   does not want to be listed at all.
2. **The public shop page itself** — the `/@handle` page exists for registered
   vendors; a virtual seller needs a read-only variant with the claim prompt.
3. **Mobile browser verification of the intake flow** — the capture has been
   exercised against real screenshots and unit tests, not yet on a phone.
4. **A privacy notice naming this collection**, signed off with the DPA position.
5. **A verified payment route** before any paid tier is described as purchasable.
6. **Kenya DPA / KYC-AML / VAT-eTIMS review** of the commercial model, by a
   professional, before money changes hands.

Until 1–5 are done, this is a **free** shop-front page plus a supervised
operations desk — which is exactly what the code implements today.
