// ---------------------------------------------------------------------------
// HOW BRIEF WORKS — the one screen that carries the explanations.
//
// The rest of the app is deliberately terse: numbers, dots, one action per empty
// state. That terseness is only honest if the reasoning is still available
// somewhere a person can reach it, so every sentence that was taken out of the
// flow lives here, in one place, readable in a minute. Nothing here is new
// information; it is the same audit trail, moved out of the working surface.
//
// Why a single screen instead of a footnote on each number: a footnote you must
// read to use the product is anxiety wearing a UX costume. A page you open when
// you want to check how a figure was produced is respect for both the sceptic and
// the person in a hurry.
// ---------------------------------------------------------------------------

import React from 'react';
import { StateDot } from '../../ui/StateDot';

interface Block {
  id: string;
  title: string;
  lines: React.ReactNode[];
}

const Section: React.FC<{ block: Block }> = ({ block }) => (
  <section className="rounded-2xl p-4 space-y-2" style={{ background: 'var(--color-paper)', boxShadow: 'var(--room-light), var(--lift-1), inset 0 0 0 1px var(--brief-line)' }}>
    <h3 className="text-[14px] font-extrabold" style={{ color: 'var(--brief-ink)' }}>{block.title}</h3>
    {block.lines.map((l, i) => (
      <p key={i} className="text-[13px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{l}</p>
    ))}
  </section>
);

export function HowBriefWorks({ className = '' }: { className?: string }) {
  const blocks: Block[] = [
    {
      id: 'counts',
      title: 'Every number is a count',
      lines: [
        'A figure in Brief is produced by reading rows on the screen you are looking at — contributions recorded, quotes sent, orders settled, hours you last confirmed. Nothing is stored as a score, nothing is rounded up, nothing is seeded to make a screen look used.',
        'A zero is shown when zero is the true count. Where a figure cannot be computed at all, the surface shows a dash or the words “not computed” — never 0, because 0 answers a question that was not asked.',
        'There is no browse log, no save counter, no view-of-a-view statistic. That is why there is no “N people are looking at this”, no percentage movement on a price, and no trend line: the rows do not exist, and a number without rows is a fabrication about somebody’s business.',
        'A shop’s view figure counts openings of its public page — one row per page read, and only page reads. It is not a headcount: no identity is attached and a person who opens it five times is five rows. That is why the number sits on the strip without a sentence about people beside it, and why no conversion rate here is offered as a benchmark: a real count with an honest denominator is printed, an absent one is printed as a dash, and nothing in between is invented.'
      ]
    },
    {
      id: 'dots',
      title: 'What a dot means',
      lines: [
        <>The word next to a dot is optional; the colour carries the state. <StateDot state="live" label="live" /> money or work that actually happened. <StateDot state="quiet" label="quiet" /> a true zero, nothing pending. <StateDot state="moving" label="moving" /> in transit right now. <StateDot state="stale" label="stale" /> past the window its own cadence sets. <StateDot state="unknown" label="no read" /> the read failed or the figure is unmeasurable.</>,
        'Staleness changes nothing about your reach. Brief does not bury, boost or rank a space for an old answer; the state is the honest fact that a number on the screen may be out of date, printed next to the age of the last real edit.'
      ]
    },
    {
      id: 'board',
      title: 'The board, the flows and why a tile is empty',
      lines: [
        'Discover counts listings whose seller declared a flow. An offer with no flow declared is not quietly folded into a category: it is counted as untagged and appears under All and in no route.',
        'A flow is defined by what it demands of a listing, and the demand is checked when the offer is written, not guessed afterwards. Bulk needs where it leaves from and where it goes. Direct needs where it comes from. Group needs where it goes. Niche needs only the goods — which is why an offer missing bulk’s two endpoints is not bulk.',
        'A route exists only because a seller wrote both endpoints; demand is counted against a route only when that seller also declared the commodity. An ask is “matched” by stated category and stated place text, which is arithmetic over fields, not a model reading titles for intent.',
        'The board is the country’s: there is no area filter, so an empty flow means nobody has declared one, not that nothing is happening near you.'
      ]
    },
    {
      id: 'world',
      title: 'The weather line',
      lines: [
        'Weather is shown on one condition: the day it describes is a day you have already committed to. The join is your own registration rows for a published or live event against a dated forecast fact for that same date — so Home carries no weather at all for a member with nothing planned, and no card is printed “because the screen needs something in it”.',
        'The facts come from Open-Meteo, a key-free public forecast service, resolved through their own gazetteer and cached for six hours per place. The payload carries the provider, the model, the elevation it read, when it was retrieved and how old that is, and the sentence on your screen is that payload’s own words — nothing is rounded, averaged or re-phrased into a stronger claim.',
        'It is a forecast, not a measurement — the payload has no observation time, and the horizon is stated. A planned day the provider gave no dated fact for is reported as unmatched, not filled with a generic forecast; and when the provider cannot be reached, no line appears at all. A gap is printed as a gap, which here means the absence of a card.',
        'A day beyond the forecast horizon is left out of the planned list rather than shown with a guess, and a campaign with no date is never defaulted to today — that would be Brief inventing a schedule.',
        'Commodity prices and pump prices are not wired. There is no key-free price source Trace can legitimately read, so no percentage and no market movement is shown anywhere, and the screen says so rather than dressing a quiet week up with an invented number.'
      ]
    },
    {
      id: 'money',
      title: 'Money',
      lines: [
        '“Settled through Brief” counts only money whose ledger row reached settled. Orders you took on WhatsApp, cash handed over at the counter and invoices paid elsewhere are not missing from the figure — they were never in it, and Brief does not guess them back in.',
        '“Marked settled” counts orders whose own status says paid, completed, settled or fulfilled. It is not a bank statement: if you mark an order settled without recording a payment, it is in the figure, and if a payment settles in a ledger row the order was never linked to, it is not. The words on the number and the rule behind it come from one place — the server sends the basis, and no screen writes its own.',
        'A space’s money is that space’s. An order joins to a space through the offer it was placed against, so two spaces of one business never both show the same takings — that was the bug, and a “Margin” was computed on top of it. An order of yours that belongs to no space is not quietly added to every space and not quietly dropped: it is counted out and said out loud, as “3 orders of this business belong to no space”.',
        '“Money out” is only the expenses you typed. There is no bank feed, no import and no receipt reader, so the panel shows the number of rows behind it and never calls the subtraction net profit or take-home: rent, credit not yet paid back and anything you did not record are simply absent.',
        'A margin against nothing sold is a dash, not 0%. “0%” states a fact — sold, kept nothing — and a shop with no settled order has not stated it.',
        'A mixed basket of currencies has no single total. The amount is dropped and the count is kept; nothing is converted at a rate Brief made up.',
        'A brief is not a bank. Brief holds no money, moves none, stores no card or M-Pesa credentials, and charges nothing. A payment you record is a record you attest to — the ledger’s authority is that you can trace every line back to a row, not that a stranger vouched for it.',
        'Escrow records in Selling describe funds held between two sides until delivery — Brief moves no money itself. A held total is the sum of locked group-buy and frozen ticket rows; the section is omitted when none are locked. HudumaLink citizen escrow is phone-keyed and read at the operator desk. There is no vault, no “healthy” badge, and no locked-KES figure without those rows.'
      ]
    },
    {
      id: 'brief',
      title: 'The morning brief',
      lines: [
        'The morning brief is a read, not a report. Nothing is stored as a brief: a day is computed from the rows that exist at the moment you open it. That is why a day you correct this afternoon is right in tomorrow’s read, why no brief can be edited or deleted, and why there is nothing to expire after seven days.',
        '“Marked in” counts orders whose own history row says they became paid or settled on that day — not orders placed that day, and not money through a rail, because no rail is connected. “Recorded out” counts only the expenses you typed with that date. The subtraction is marked in minus recorded out, never net profit: there is no bank feed, no receipt reader and no supplier import.',
        'A day with no rows is reported as an empty day, not as a page of zeroes. A figure that cannot be computed at all prints as a dash: money settled through a rail, or the count a shelf started the day on when stock tracking began mid-morning, are unmeasurable rather than zero.',
        'The shelf flag is not a stock system. Brief has no declared-stock field, no “expected remaining” and no waste log — so what it keeps, from the day this screen was built onward, is one append-only row per movement of a count. The flag can therefore say only: 4 sold, the count ended at 10 where the sales leave 6, typed by you at 20:04. A legitimate restock looks exactly identical in these rows, and the flag says that instead of accusing anybody.',
        'No rota exists, so nobody is ever reported absent. A person is named under “Recorded by” only when a user row carries a name; an actor with no user row prints as “someone with no name on record”, because guessing one from a phone number is how an accusation starts.',
        'A morning notification is off until you turn it on and name an hour in Nairobi time. Nothing is sent for a day with no rows, and one brief per day at most. There is no stored 6am default anywhere: the app will not write a preference nobody set, and it will not send at an hour it chose for you.',
        'An order that no space can claim is counted for the business and left out of every space, and the brief says the two are meant to differ. The same rule keeps two spaces of one shop from each reporting the shop’s whole takings — the bug that once produced a “Margin” out of one figure divided by itself.',
        'What the brief refuses: ranks, tiers, badges, streaks, “top 10% of shops like yours”, sector averages, targets, forecasts and recommendations. It reports yesterday. It does not advise, compare or predict, and it never tells you what to stock.'
      ]
    },
    {
      id: 'inout',
      title: 'Getting in and getting out',
      lines: [
        'Home is the operational read: open inquiries, open orders, active offers and money marked in today, each from its server rows. “Marked in” follows order status history and is not payment-rail settlement; an empty day stays a dash, and a failed read is unavailable rather than zero. The public board remains a separate Explore destination.',
        'The band is search and the area you typed — it does not reprint a screen title. The area is used for the forecast and is optional. A weather line appears on a day you have something planned; that is why the area exists, and why the band does not explain it twice.',
        "The board is a secondary room, not the operational Home. Explore Wairo is a direct entry; what people are selling, hosting and needing carried is what the board's rooms hold, not a fabricated seller metric.",
        'You is a list of titles. The notes under Profile, Standing, Following and the rest live here. Your account is not a page title. Identity, Business and Money stay on You. Tapping a title raises a sheet from the lower segment — the grid stays where it is, scroll does not move, and the groups are not covered by a full screen. Opening a panel under the list made the operator scroll past the tiles they just tapped, so that expansion left.',
        'Spaces and Selling are separate destinations. Spaces holds the workspaces you operate or join; each Space keeps its own public identity, offers, conversations and community. Selling is the existing seller panel for listings and orders. The daily Home summary is a read over current rows; the longer morning brief remains a separate, optional day-by-day read.',
        'Every secondary screen is a URL: the drawer is #menu, the create sheet is #create, the event sheet is #host, a space you operate is #shop/<id>. That is not for sharing (though a pasted link does open the screen), it is so the back gesture on a phone is a way out. A screen held only in memory has no exit for a gesture, which is what “the back button doesn’t work” actually means.',
        'Closing a surface puts the URL back on the screen underneath it, not on nothing. Clearing a URL to the root is how an app throws a person to Home and looks, from a phone, like it lost their place.',
        'Where a control has nowhere to go, it is not rendered. A saved item with no detail screen is a row, not a button; a checklist step with no group behind it says “needs a group that exists first” instead of offering a tap that does nothing. The first-run card once carried three buttons wired to an empty function — three promises, none of them kept.',
        'An offer’s photographs are the seller’s own files, uploaded from the create form as well as from the catalog, up to the number the store keeps (8). No stock image, no example photo and no placeholder frame is ever put on an offer: a buyer reads whatever appears as the goods, so a picture the seller did not supply is a lie about the shop. Until one is added, the listing says so — “No photo yet. Buyers see the name and the price alone.”'
      ]
    },
    {
      id: 'defended',
      title: 'Standing, commitments and Defended',
      lines: [
        'A commitment is a promise someone is waiting on: a quote of yours that was accepted, or an order you took. It closes when it is fulfilled, and lapses when the window passes without it. Defended is the share of your closed commitments you kept — a fraction over real rows, with the sample size printed beside it, because 3 of 4 is not the same statement as 300 of 400.',
        'The stricter version — of members whose position decayed in a given week, how many defended within 72 hours — is not shown, because Brief keeps no decay-event log or cohort table to divide by. It will be computed the day those rows exist.',
        'A missed capture is only ever a real event: one of your quotes declined because the buyer chose another option. Its value is your own offer’s total, read from your terms. Never the winner’s price, never “what you could have earned”, and where your offer carried no completed price, no figure at all.'
      ]
    },
    {
      id: 'spacefile',
      title: 'The to-do list on a space',
      lines: [
        'A space holds a small set of answers — what you sell, capacity, hours, where you operate from, coverage, what you cannot do, what you need, what you offer the network, and optionally the number a buyer should reach you on. Each answer carries the time it was written and the time it was last confirmed, both written by the server, and each has its own refresh window.',
        'The list you are shown is derived from those timestamps plus the live rows around them: a question never answered, one past its window, a buyer’s message you have not replied to, a draft offer nobody can buy. Answering one removes its line. Nothing on the list can be bought, and none of it opens or closes a door to better placement. The contact number is the one question you may leave blank on purpose: it is marked optional, so it never counts as an open item and never appears as a to-do.',
        'Re-sending an answer you already gave counts as a confirmation, not an edit. That is what keeps “fresh” meaningful: it is evidence someone touched the fact, not that a button was pressed.'
      ]
    },
    {
      id: 'carriers',
      title: 'Parcels, riders and carriers',
      lines: [
        'A dispatch is a parcel you assign to a named rider and Brief tracks through the stages you record. An errand is a need you post, which any eligible carrier in the network can accept. Both live on the same screen because both are one thing: moving an object between two people.',
        'Only accounts with a real basis can carry: a field-agent or partner role, an active shop claim, or a pickup already assigned to that person. The badge says which one it was, in words, with the code kept on the element for an audit.',
        'Other mailing and cargo services are not listed on Errands at all. A name with no phone number, no price and no promise is not an offer, and Brief has no integration with them, so there is no strip to tap. Arrange and pay them directly.',
        'One rating per delivery, left by each side about the other, listed as it was said. No average, no score, no reputation index, and nothing that turns a star into a rank. A rating changes nothing about who sees your errand.'
      ]
    },
    {
      id: 'groups',
      title: 'Groups, chamas and the operator read',
      lines: [
        'A group’s pool is derived from recorded contributions, payouts, loans and repayments every time it is read. Brief holds none of that money. Payouts need a maker and a checker, and a payout is not complete until both exist.',
        'The operator read shows what the group itself did: the requests it placed and what they became, the money that settled through Brief, and — to the group owner only — each member’s public shopfront: that it exists, how many live offers, how current its answers are.',
        'What it will not produce: a member’s turnover outside the group, the share of a member’s sales “brought by the group” (there is no attribution row), staff hours or attendance, a ranking of members by contribution or reliability, and any cross-group benchmark. Each is listed on the payload as an absent figure with the reason, so the gap is a decision rather than an oversight.',
        'There is no Hubs tab. A lounge is a Group; a pool is a group buy; a boda or errand is a Run. Counts of “14 hubs” or a Circle 001 with a pledged total are not printed because those rows do not exist.'
      ]
    },
    {
      id: 'mirror',
      title: 'Your public page is a mirror',
      lines: [
        'A public space has one page, at /s/ followed by the name the server minted from your space name. It is rendered by the server from the same rows the app reads, which is why a shared link shows a preview in WhatsApp and why a price cannot disagree with the counter.',
        'There is nothing to design. No theme, no font, no section order, no builder. One layout, tinted by nothing but your own cover photo. A page you have to maintain is a page that goes stale, and a stale page about a live business is worse than no page.',
        'What it shows: the name, your one line, the place and hours you stated, every live offer with its price, your unit and minimum, a stock figure if you track one, your latest update, the follower rows people wrote, and a WhatsApp button only if you published a number. Everything on it is something you already answered in the space.',
        'What it cannot show: reviews or stars (Brief stores none per completed order as an average), a verified tick, a “popular” mark, a rank in your area, a sector benchmark, or an “open now” claim your own hours answer does not support. Hours are read against East Africa Time, and the page prints that fact rather than leaving you to wonder.',
        'Making a space public publishes it, so it is confirmed first, in words, with the address it creates. Turning it private takes the page down on the next read — nothing is cached behind it, and no copy of it is kept.',
        'A visitor may file one report from the page. It stores a row that you and Brief can read; it does not take a page down, because Brief has no automated review to promise. If that ever changes, this page is where the change is written down first.'
      ]
    },
    {
      id: 'guardians',
      title: 'Who introduced a shop, and what that earns',
      lines: [
        'A member may claim that they walked a business through signing up. The claim is stored as unanswered, and it credits nothing until the shop confirms it. A dispute closes it for everybody: Brief has no mediator, so it does not host the same argument twice and it does not let a claimant ask again.',
        'A confirmed guardian earns one point per KES 100 that settles through that shop, for 24 months, and the credit pauses the moment the shop has three open reports from signed-in people. Points become cash only inside the rewards pool — a fraction of confirmed service-fee revenue — and a conversion above the pool is refused rather than advanced.',
        'A guardian is never shown the shop’s revenue, customers or ledger, and the shop is never charged for the credit: it comes from Brief’s pool, not out of what the shop earns.',
        'What Brief will not compute for a guardian: a star rating or any average of reviews (there are no review rows for a shop’s orders), a complaint rate (there is no denominator of transactions to divide by), a “good standing” score, or an automatic takedown — a report freezes the credit and tells an operator; nobody removes a shop on a form.',
        'There is also no percentage cut of an order. That would need Brief to charge a percentage fee on orders, which it does not: fees here are named services with a price, sold and confirmed by a human. A “1% of the 6% we take” would be a share of money that never existed.'
      ]
    },
    {
      id: 'never',
      title: 'What Brief never shows',
      lines: [
        'Seeded activity, demo crowds, “N buyers waiting”, verified badges nobody verified, counts of people viewing, urgency timers on a link that does not expire, leaderboards, streaks, tiers, badges for using the app, and QR codes for pages that do not resolve.',
        'A trust score out of 100, “Good Standing”, SACCO credit of KES 50,000, “3 Bids” on an errand nobody posted, a countdown on a bid, and a photograph of Unga that is not the seller’s file are mockups. They are not printed. Standing is counts over your rows. An empty errand board is empty.',
        'There is no Trust tab and no Errands tab. The primary bar is Market · Shops · Trade · You · [+]: the market is the first page, and Shops opens on what needs your attention today. Wairo is the network brand; it does not grow an invented trust score or pretend to own a payment rail.',
        'Wairo is not a merchant. It does not take stock, promise a rider will arrive or lend. Standing is counts over your rows — not a score out of 100 or a SACCO offer.',
        'KEEP: Market · Shops · Trade · You · [+]. Spaces stay distinct from the public board. Errands stay gated by a real basis. Create lands on existing flows; empty boards stay empty. M-Pesa is a rail we do not pretend to own.',
        'ENHANCE: the knot and wordmark, real seller activity at the top of Shops, and a small dismissible announcement after the working summary.',
        'NOT BUILT: voice-note listings, USSD *384#, STK escrow, a 2% cut, Wairo Pro, auto-filled speech, a demand line that invents three people in Ruiru. Each is named here so a mockup cannot land as a screen.',
        'Where a reference would have to be invented — a carrier’s phone number, a partner’s volume, a sector average — the field is empty and says why. An honest blank is the product.'
      ]
    }
  ];

  return (
    <div className={`space-y-3 max-w-2xl mx-auto ${className}`}>
      <div className="space-y-1">
        <h2 className="text-[32px] font-extrabold" style={{ color: 'var(--brief-ink)' }}>How Wairo works</h2>
        <p className="text-[13px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
          The digital street where business gets done. Everything the screens deliberately do not say, in one place.
        </p>
      </div>
      {blocks.map((b) => <Section key={b.id} block={b} />)}
      <p className="text-[12px] leading-snug px-1 pb-2" style={{ color: 'var(--color-text-muted)' }}>
        If a figure on any screen contradicts this page, the figure is wrong and the page is out of date. Both are bugs; report either.
      </p>
    </div>
  );
}

export default HowBriefWorks;
