import './test-env.mjs';
import { store } from '../src/store.js';
import * as spaces from '../src/domain/space.js';
import * as auth from '../src/domain/auth.js';

function check(label, pass, detail) {
  // A Promise is truthy whatever it resolves to — refuse it rather than print PASS.
  if (pass && typeof pass.then === 'function') {
    console.error(`  FAIL  ${label} — condition is a Promise; await it before asserting`);
    process.exitCode = 1;
    return;
  }
  if (pass) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    process.exitCode = 1;
  }
}

console.log('\n=== SPACES DOMAIN (Brief 2.0 — Digital Landlord & Phase 2 Chat Rails) ===');

store._reset();

const userA = auth.createUser({ handle: 'amina', displayName: 'Amina', password: 'password123' });
const userB = auth.createUser({ handle: 'mary', displayName: 'Mary', password: 'password123' });

// 1. Create Space
const space = spaces.createSpace({
  ownerId: userA.id,
  name: "Amina's Cakes",
  type: 'business',
  goal: 'Get my first 20 customers',
  targetValueKes: 100000
});

check('space created with unguessable id', space.id.startsWith('spc_'));
check('space owner matches caller', space.ownerId === userA.id);
check('space name is saved', space.name === "Amina's Cakes");
check('space goal is saved', space.goal === 'Get my first 20 customers');
check('underlying vendor created and linked', space.vendorId && space.vendorId.startsWith('vend_'));
check('initial activity recorded', space.recentActivities.length >= 1 && space.recentActivities[0].kind === 'space_created');

// 2. List spaces for owner
const aminaSpaces = spaces.listSpacesForOwner(userA.id);
check('owner can list own spaces', aminaSpaces.length === 1 && aminaSpaces[0].id === space.id);

const marySpaces = spaces.listSpacesForOwner(userB.id);
check('other user has no spaces yet', marySpaces.length === 0);

// 3. Create Offer (Listing) inside Space
const offer = spaces.createSpaceOffer(space.id, {
  title: 'Birthday Cake',
  description: 'Custom birthday cake for 10-15 people',
  price: 4500,
  currency: 'KES',
  type: 'product',
  callerId: userA.id
});

check('offer created with price', offer.price === 4500);
check('offer tagged with spaceId', offer.spaceId === space.id);
check('offer starts as draft', offer.status === 'draft');

// 4. Unauthorized offer creation rejected
let unauthFailed = false;
try {
  spaces.createSpaceOffer(space.id, {
    title: 'Hacked Cake',
    price: 10,
    callerId: userB.id
  });
} catch {
  unauthFailed = true;
}
check('non-owner cannot create offer in another user space', unauthFailed);

// 5. Publish Offer
const published = spaces.publishSpaceOffer(space.id, offer.id, { callerId: userA.id });
check('offer is published and active', published.status === 'active');

// 6. Customer Conversation (Contextual Inquiry)
const conv = spaces.createSpaceConversation({
  spaceId: space.id,
  offerId: offer.id,
  customerName: 'Mary',
  customerContact: '+254712345678',
  message: 'Can you make this cake for Saturday?'
});

check('conversation created with offer context', conv.offerId === offer.id && conv.offerTitle === 'Birthday Cake');
check('conversation customer message attached', conv.messages.length === 1 && conv.messages[0].text.includes('Saturday'));

// Home needs a complete inbox count, not the newest ten conversation previews.
for (let i = 0; i < 11; i++) {
  spaces.createSpaceConversation({
    spaceId: space.id,
    offerId: offer.id,
    customerName: `Customer ${i + 1}`,
    message: `Question ${i + 1}`
  });
}
const inboxHydrated = spaces.getSpace(space.id);
check('inbox count includes all 12 open inquiries, beyond the 10-row preview',
  inboxHydrated.metrics.inquiriesAwaitingReply === 12 && inboxHydrated.recentConversations.length === 10);

// 7. Inbound WhatsApp Message Route
const waConv = spaces.routeInboundWhatsAppMessage({
  spaceId: space.id,
  from: '+254712345678',
  customerName: 'Mary',
  text: 'Also chocolate flavor please!'
});
check('WhatsApp message appends to existing conversation', waConv.id === conv.id && waConv.messages.length === 2);
check('WhatsApp message body preserved', waConv.messages[1].text.includes('chocolate flavor'));

// 8. In-Thread Quotation (Customized Price KES 5,200)
const quote = spaces.createSpaceQuote({
  spaceId: space.id,
  conversationId: conv.id,
  title: '2-Tier Chocolate Birthday Cake',
  priceKes: 5200,
  notes: 'Including Saturday Kilimani delivery',
  callerId: userA.id
});
check('custom quote created with server price', quote.priceKes === 5200);
check('quote message posted into conversation', spaces.getSpaceConversations(space.id)[0].quotes.length === 1);

// 9. Trigger M-Pesa STK Push
const mpesaPrompt = spaces.triggerMpesaPrompt({
  spaceId: space.id,
  conversationId: conv.id,
  quoteId: quote.id,
  phoneNumber: '+254712345678',
  amountKes: 5200,
  description: 'Amina Cakes: Chocolate Birthday Cake',
  callerId: userA.id
});
check('M-Pesa prompt created in pending state', mpesaPrompt.status === 'pending' && mpesaPrompt.amountKes === 5200);

// 10. Complete M-Pesa Payment & Auto-Convert to Order
const paymentResult = spaces.completeMpesaPayment({
  spaceId: space.id,
  conversationId: conv.id,
  paymentRequestId: mpesaPrompt.id,
  mpesaReceipt: 'QJ891234AB',
  amountPaid: 5200
});
check('payment status completed and confirmed', paymentResult.status === 'paid' && paymentResult.receipt === 'QJ891234AB');
check('order auto-created with exact paid amount', paymentResult.order.total === 5200 && paymentResult.order.status === 'paid');
check('order tagged with space and customer', paymentResult.order.spaceId === space.id && paymentResult.order.customerName === 'Mary');

// 11. Hydrated Space State with Live Metrics
const hydrated = spaces.getSpace(space.id);
check('hydrated space shows active offer count', hydrated.metrics.offersCount >= 1);
check('hydrated space shows customer count', hydrated.metrics.customerCount >= 1);
check('hydrated space shows total paid revenue KES 5,200', hydrated.metrics.revenueKes === 5200);
check('hydrated space shows active orders count', hydrated.metrics.activeOrdersCount >= 1);
check('converted inquiry leaves the exact awaiting-reply count', hydrated.metrics.inquiriesAwaitingReply === 11);
check('the full inbox count is not replaced by its ten-row preview', hydrated.recentConversations.length === 10);

// 12. Activity Stream
const activities = spaces.getSpaceActivities(space.id);
check('activity stream records payment and auto-conversion',
  activities.some(a => a.kind === 'payment_received') &&
  activities.some(a => a.kind === 'quote_sent') &&
  activities.some(a => a.kind === 'mpesa_prompt_sent'));

// 13. Money Rails: Record Expense
const expense1 = spaces.recordSpaceExpense({
  spaceId: space.id,
  category: 'supplies',
  description: 'Baking flour, eggs & vanilla essence',
  amountKes: 1850,
  callerId: userA.id
});
check('expense recorded with server amount', expense1.amountKes === 1850);
check('expense attached to space', expense1.spaceId === space.id);

// 14. DukaBook: Customer Credit Tab (Lipa Pole Pole)
const tab1 = spaces.recordCustomerTab({
  spaceId: space.id,
  customerName: 'Mary',
  customerContact: '+254712345678',
  amountKes: 3000,
  note: 'Balance for weekend celebration cupcakes',
  callerId: userA.id
});
check('customer tab created with balance', tab1.balanceKes === 3000 && tab1.status === 'active');

// 15. Record Tab Repayment
const tabPaid = spaces.recordTabPayment({
  spaceId: space.id,
  tabId: tab1.id,
  amountKes: 2000,
  note: 'M-Pesa partial installment',
  callerId: userA.id
});
check('partial payment updates remaining balance to 1,000', tabPaid.balanceKes === 1000 && tabPaid.status === 'active');

// 16. Comprehensive Money Summary & Profit Calculation
const moneySummary = spaces.getSpaceMoneySummary(space.id);
check('total revenue reflects paid order (5,200)', moneySummary.totalRevenueKes === 5200);
check('total expenses reflects recorded supplies (1,850)', moneySummary.totalExpensesKes === 1850);
check('net profit is 3,350 (5,200 - 1,850)', moneySummary.netProfitKes === 3350);
check('total receivables reflects remaining tab (1,000)', moneySummary.totalReceivablesKes === 1000);

// 17. Inter-County Cargo Dispatch (Option C)
const dispatch = spaces.createSpaceDispatch({
  spaceId: space.id,
  orderId: paymentResult.order.id,
  destinationCounty: 'Nakuru',
  destinationTown: 'Nakuru Town (KFA Stage)',
  carrierSacco: '2NK Sacco',
  waybillRef: 'WAY-2NK-4491',
  receiverName: 'Mary Wanjiku',
  receiverPhone: '+254712345678',
  conductorContact: '+254722000111',
  stageFeeKes: 400,
  notes: 'Fragile: 2-Tier Birthday Cake, handle with care',
  callerId: userA.id
});

check('cargo dispatch created with waybill', dispatch.waybillRef === 'WAY-2NK-4491' && dispatch.status === 'in_transit');
check('dispatch tags destination stage', dispatch.destinationTown.includes('Nakuru'));

// 18. Dispatch Status Update
const updatedDispatch = spaces.updateDispatchStatus({
  spaceId: space.id,
  dispatchId: dispatch.id,
  status: 'ready_at_stage',
  conductorContact: '+254722000111',
  callerId: userA.id
});
check('dispatch transitions to ready_at_stage', updatedDispatch.status === 'ready_at_stage');

// 19. Space Activity Log contains parcel_dispatched
const finalActivities = spaces.getSpaceActivities(space.id);
check('activity log records parcel_dispatched event', finalActivities.some(a => a.kind === 'parcel_dispatched'));

// ---------------------------------------------------------------------------
// REGRESSION: a space shares its owner's vendor, so `offers` can contain
// pre-existing listings. `createSpace` must return the SPECIFIC initial offer
// id (`initialOfferId`), never force the caller to guess `offers[0]`.
// ---------------------------------------------------------------------------
const repeatOwner = auth.createUser({ handle: 'repeatowner', displayName: 'Repeat', password: 'password123' });
// The owner already has a vendor with an ACTIVE listing (e.g. from Marketplace).
const { createVendor } = await import('../src/domain/vendor.js');
const { createListing, transitionListing } = await import('../src/domain/listing.js');
const preVendor = createVendor({ ownerId: repeatOwner.id, displayName: 'Old Shop' });
const oldListing = createListing({ vendorId: preVendor.id, title: 'Old Widget', price: 100, currency: 'KES' });
transitionListing(oldListing.id, 'active');

const space2 = spaces.createSpace({
  ownerId: repeatOwner.id,
  name: 'My New Shop',
  type: 'business',
  goal: 'launch',
  // The photos a seller attaches while creating the space used to stop at the
  // route: `initialOffer` was copied field by field and `images` was not one of
  // the copied names, so the first offer of a brand-new shop was born photoless.
  initialOffer: { title: 'New Cake', price: 4500, currency: 'KES', images: ['/api/media/file/upl_first', '/api/media/file/upl_first'] }
});

check('createSpace returns the specific initialOfferId', Boolean(space2.initialOfferId) && space2.initialOfferId.startsWith('list_'));
check('initialOfferId is the NEW offer, not a pre-existing listing', space2.initialOfferId !== oldListing.id);
check('offers still include the pre-existing listing (shared vendor)', space2.offers.some((o) => o.id === oldListing.id));

const pub2 = spaces.publishSpaceOffer(space2.id, space2.initialOfferId, { callerId: repeatOwner.id });
check('publishing by initialOfferId activates the NEW offer', pub2.status === 'active' && pub2.id === space2.initialOfferId);

const again2 = spaces.getSpace(space2.id, { callerId: repeatOwner.id });
const newOffer = again2.offers.find((o) => o.id === space2.initialOfferId);
check('the new offer is active after publishing it specifically', newOffer && newOffer.status === 'active');
check('the initial offer carries the photos it was created with',
  Array.isArray(newOffer?.media) && newOffer.media.length === 1,
  `media=${JSON.stringify(newOffer?.media)}`);
check('and the same photo twice is one photo, not two tiles',
  newOffer?.media?.[0] === '/api/media/file/upl_first');
check('the pre-existing listing was not touched by the new offer’s photos',
  JSON.stringify(store.find('listings', (l) => l.id === oldListing.id)?.media) === '[]');

console.log('SPACES DOMAIN, CHAT, MONEY & CARGO DISPATCH TESTS PASSED!\n');
