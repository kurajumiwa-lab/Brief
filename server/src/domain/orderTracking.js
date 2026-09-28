// Customer tracking is a projection over orders + spaceDispatches, not a new
// order, carrier, payment or ledger system. Public access is narrowly scoped.
import crypto from 'node:crypto';
import { store, newId } from '../store.js';

const failure = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const digest = (value) =>
  crypto.createHash('sha256').update(value).digest('hex');
const same = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.length === b.length &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const emailHash = (email) =>
  crypto
    .createHmac('sha256', secret())
    .update(
      String(email ?? '')
        .trim()
        .toLowerCase()
    )
    .digest('hex');
const validEmail = (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
const text = (value, max = 500) =>
  String(value ?? '')
    .trim()
    .slice(0, max);
const secret = () => {
  let row = store.find('appSecrets', (s) => s.name === 'order_tracking');
  if (!row)
    row = store.insert('appSecrets', {
      id: newId('secret'),
      name: 'order_tracking',
      value: crypto.randomBytes(32).toString('hex')
    });
  return row.value;
};
const proof = (order) =>
  Object.hasOwn(order, 'trackingEmailHash')
    ? order.trackingEmailHash
    : store.find('users', (u) => u.id === order.buyerId)?.email
      ? emailHash(store.find('users', (u) => u.id === order.buyerId).email)
      : null;
export function deliveryFields(input, fallbackEmail = null) {
  const email = text(input?.email || fallbackEmail, 255).toLowerCase();
  if (email && !validEmail(email))
    throw failure('Enter a valid tracking email.');
  return {
    trackingEmailHash: email ? emailHash(email) : null,
    deliveryAddress: text(input?.address),
    deliveryInstructions: text(input?.instructions)
  };
}
const sellerId = (order) =>
  order.vendorOwnerId ||
  store.find('vendors', (v) => v.id === order.vendorId)?.ownerId;
export function dispatchesFor(order) {
  return store
    .filter(
      'spaceDispatches',
      (d) =>
        d.orderId === order.id &&
        store.find('spaces', (s) => s.id === d.spaceId)?.ownerId ===
          sellerId(order) &&
        (!order.spaceId || d.spaceId === order.spaceId)
    )
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
    );
}
function issue(order, canManage = false, canRespond = false) {
  const expiresAt = Date.now() + 30 * 60 * 1000;
  const payload = Buffer.from(
    JSON.stringify({ id: order.id, proof: proof(order), expiresAt })
  ).toString('base64url');
  const token = `${payload}.${crypto.createHmac('sha256', secret()).update(payload).digest('hex')}`;
  return {
    token,
    expiresAt: new Date(expiresAt).toISOString(),
    tracking: project(order),
    canManage,
    canRespond
  };
}
export function lookup(orderNumber, email) {
  const id = text(orderNumber, 128),
    normalized = text(email, 255).toLowerCase();
  const order = store.find('orders', (o) => o.id === id);
  const expected = order ? proof(order) : digest('unavailable');
  if (
    !validEmail(normalized) ||
    !same(emailHash(normalized), expected) ||
    !order
  )
    throw failure(
      'No matching order. Check the order number and tracking email.',
      404
    );
  return issue(order);
}
export function accountTracking(orderId, userId) {
  const order = store.find('orders', (o) => o.id === orderId);
  if (!order || !userId || ![order.buyerId, sellerId(order)].includes(userId))
    throw failure('Order not found.', 404);
  return issue(order, userId === order.buyerId, userId === sellerId(order));
}
export function readToken(token) {
  try {
    if (typeof token !== 'string' || token.length > 1500) throw new Error();
    const [payload, signature, extra] = token.split('.');
    if (
      extra ||
      !same(
        signature,
        crypto.createHmac('sha256', secret()).update(payload).digest('hex')
      )
    )
      throw new Error();
    const claim = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const order = store.find('orders', (o) => o.id === claim.id);
    if (
      !order ||
      !Number.isFinite(claim.expiresAt) ||
      claim.expiresAt <= Date.now() ||
      claim.proof !== proof(order)
    )
      throw new Error();
    return order;
  } catch {
    throw failure('Tracking access expired. Look up your order again.', 410);
  }
}
export function setDeliveryDetails(orderId, userId, input) {
  const order = store.find(
    'orders',
    (o) => o.id === orderId && o.buyerId === userId
  );
  if (!order) throw failure('Order not found.', 404);
  if (
    dispatchesFor(order).length ||
    ['fulfilled', 'settled', 'cancelled', 'disputed'].includes(order.status)
  )
    throw failure(
      'This order has already progressed. Contact the seller to change delivery details.',
      409
    );
  const email = text(input.email, 255).toLowerCase();
  if (!validEmail(email)) throw failure('Enter a valid tracking email.');
  const deliveryAddress = text(input.address),
    deliveryInstructions = text(input.instructions);
  store.update('orders', order.id, {
    trackingEmailHash: emailHash(email),
    deliveryAddress,
    deliveryInstructions,
    updatedAt: new Date().toISOString()
  });
  return accountTracking(order.id, userId);
}
export function addRequest(token, input) {
  const order = readToken(token);
  const kind = text(input.kind, 30),
    message = text(input.message),
    shipmentId = input.shipmentId || null;
  if (
    ![
      'preferences',
      'neighbor',
      'hold',
      'not_arrived',
      'wrong_item',
      'support'
    ].includes(kind)
  )
    throw failure('Choose a valid request.');
  if (message.length < 3) throw failure('Add a few details for the seller.');
  const shipments = dispatchesFor(order),
    shipment = shipments.find((d) => d.id === shipmentId);
  if (shipmentId && !shipment) throw failure('Shipment not found.', 404);
  if (
    ['preferences', 'neighbor', 'hold'].includes(kind) &&
    shipments.length &&
    !shipment
  )
    throw failure('Choose a shipment for delivery preferences.');
  if (
    ['preferences', 'neighbor', 'hold'].includes(kind) &&
    ((['cancelled', 'fulfilled', 'settled'].includes(order.status) &&
      !shipments.length) ||
      order.status === 'cancelled' ||
      (shipment &&
        ['collected', 'delivered', 'cancelled'].includes(shipment.status)))
  )
    throw failure(
      'Delivery preferences can no longer be changed for this shipment.',
      409
    );
  const rows = order.trackingRequests ?? [],
    key = text(input.key, 100);
  if (!key) throw failure('A request reference is required.');
  if (rows.some((r) => r.key === key)) return project(order);
  if (rows.length >= 50)
    throw failure('Request limit reached. Contact the seller directly.', 429);
  const request = {
    id: newId('trq'),
    key,
    kind,
    message,
    shipmentId,
    status: 'requested',
    createdAt: new Date().toISOString()
  };
  store.update('orders', order.id, {
    trackingRequests: [...rows, request],
    updatedAt: request.createdAt
  });
  return project(store.find('orders', (o) => o.id === order.id));
}
export function respond(orderId, requestId, userId, status) {
  const order = store.find(
    'orders',
    (o) => o.id === orderId && sellerId(o) === userId
  );
  if (!order) throw failure('Order not found.', 404);
  if (!['acknowledged', 'declined'].includes(status))
    throw failure('Choose acknowledged or declined.');
  if (!(order.trackingRequests ?? []).some((r) => r.id === requestId))
    throw failure('Request not found.', 404);
  store.update('orders', order.id, {
    trackingRequests: order.trackingRequests.map((r) =>
      r.id === requestId
        ? { ...r, status, respondedAt: new Date().toISOString() }
        : r
    )
  });
  return project(store.find('orders', (o) => o.id === order.id));
}

const ORDER_LABELS = {
  offered: 'Offer recorded',
  ordered: 'Order placed',
  accepted: 'Order confirmed',
  preparing: 'Preparing your order',
  ready: 'Ready for dispatch',
  fulfilled: 'Order fulfilled',
  settled: 'Payment settled',
  disputed: 'Issue reported',
  cancelled: 'Order cancelled'
};
const SHIPMENT_LABELS = {
  shipped: 'Shipped',
  staged: 'Staged for dispatch',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  ready_at_stage: 'Ready at destination stage',
  collected: 'Collected',
  delivered: 'Delivered',
  cancelled: 'Shipment cancelled'
};
const descriptions = {
  ordered:
    'Your order is with the seller. Confirmation will appear when recorded.',
  accepted: 'The seller has confirmed your order.',
  preparing: 'The seller is preparing your order.',
  ready: 'Your order is ready. Waiting for a dispatch update.',
  shipped: 'Your parcel has been dispatched.',
  in_transit: 'Your package is on its way!',
  staged: 'Your parcel is waiting at the departure stage.',
  out_for_delivery: 'Your parcel is on the final leg of its journey.',
  ready_at_stage:
    'Your parcel is ready for collection. Confirm the pickup details with the carrier.',
  collected: 'Collection has been recorded by the seller.',
  delivered: 'Delivery has been recorded by the seller.',
  fulfilled: 'The seller has recorded fulfilment.',
  settled: 'Payment is recorded. No delivery update has been recorded.',
  cancelled: 'This order or shipment has been cancelled.',
  disputed: 'An issue has been reported. Contact the seller for the next step.'
};
const event = (status, at, location, source, label) => ({
  status,
  label,
  at: at || null,
  location: location || null,
  source
});
function shipmentView(order, dispatch, orderEvents) {
  const mode =
    dispatch?.deliveryMode === 'door' ? 'door' : dispatch ? 'stage' : 'door';
  const recorded = dispatch?.history?.length
    ? dispatch.history
    : dispatch
      ? [
          {
            status: dispatch.status,
            at: dispatch.updatedAt || dispatch.createdAt
          }
        ]
      : [];
  const shippingEvents = recorded
    .filter((e) => SHIPMENT_LABELS[e.status])
    .map((e) =>
      event(
        e.status,
        e.at,
        e.location,
        'Seller dispatch record',
        SHIPMENT_LABELS[e.status]
      )
    );
  if (
    dispatch &&
    recorded.some((e) =>
      [
        'in_transit',
        'out_for_delivery',
        'ready_at_stage',
        'collected',
        'delivered'
      ].includes(e.status)
    )
  )
    shippingEvents.push(
      event(
        'shipped',
        dispatch.createdAt,
        null,
        'Seller dispatch record',
        'Dispatch recorded'
      )
    );
  const events = [...orderEvents, ...shippingEvents].sort((a, b) =>
    String(b.at).localeCompare(String(a.at))
  );
  let status =
    dispatch?.status || (order.fulfilledAt ? 'fulfilled' : order.status);
  if (['cancelled', 'disputed'].includes(order.status)) status = order.status;
  const steps = [
    ['ordered', 'Order placed'],
    ['accepted', 'Order confirmed'],
    ['shipped', 'Shipped'],
    ['in_transit', 'In transit'],
    [
      mode === 'stage' ? 'ready_at_stage' : 'out_for_delivery',
      mode === 'stage' ? 'Ready at stage' : 'Out for delivery'
    ],
    [
      mode === 'stage' ? 'collected' : 'delivered',
      mode === 'stage' ? 'Collected' : 'Delivered'
    ]
  ];
  if (!dispatch && order.fulfilledAt)
    steps.splice(2, 4, ['fulfilled', 'Fulfilled']);
  if (!dispatch && ['preparing', 'ready'].includes(status))
    steps.splice(2, 0, [status, ORDER_LABELS[status]]);
  if (dispatch?.status === 'staged')
    steps.splice(2, 0, ['staged', 'Staged for dispatch']);
  const timeline = steps.map(([id, label]) => {
    const fact = events.find((e) => e.status === id);
    return {
      id,
      label,
      at: fact?.at ?? null,
      location: fact?.location ?? null,
      completed: Boolean(fact),
      current: id === status
    };
  });
  return {
    id: dispatch?.id ?? 'order',
    mode,
    status,
    label: SHIPMENT_LABELS[status] || ORDER_LABELS[status] || 'Awaiting update',
    description:
      descriptions[status] || 'Waiting for the next recorded update.',
    carrier: dispatch?.carrierSacco || null,
    trackingNumber: dispatch?.waybillRef || null,
    carrierContact: dispatch?.conductorContact || null,
    trackingReferenceKind: dispatch?.waybillSource || 'unspecified',
    estimatedDelivery: dispatch?.estimatedDelivery || null,
    destination: dispatch
      ? [dispatch.destinationTown, dispatch.destinationCounty]
          .filter(Boolean)
          .join(', ')
      : null,
    lastLocation:
      shippingEvents
        .slice()
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
        .find((e) => e.location)?.location ?? null,
    quantity: dispatch?.quantity ?? null,
    canRequestPreferences: ![
      'collected',
      'delivered',
      'fulfilled',
      'cancelled',
      'disputed',
      'settled'
    ].includes(status),
    timeline,
    events
  };
}
export function project(order) {
  const vendor = store.find('vendors', (v) => v.id === order.vendorId);
  const orderEvents = (order.history ?? [])
    .filter((e) => ORDER_LABELS[e.status])
    .map((e) =>
      event(e.status, e.at, null, 'Order record', ORDER_LABELS[e.status])
    );
  if (!orderEvents.some((e) => e.status === 'ordered'))
    orderEvents.push(
      event('ordered', order.createdAt, null, 'Order record', 'Order placed')
    );
  if (order.fulfilledAt && !orderEvents.some((e) => e.status === 'fulfilled'))
    orderEvents.push(
      event(
        'fulfilled',
        order.fulfilledAt,
        null,
        'Order record',
        'Order fulfilled'
      )
    );
  const dispatches = dispatchesFor(order);
  return {
    orderNumber: order.id,
    orderDate: order.createdAt,
    orderStatus: order.status,
    seller: vendor?.displayName ?? 'Seller',
    sellerContact:
      typeof vendor?.contactMethod === 'string' ? vendor.contactMethod : null,
    deliveryAddress: order.deliveryAddress || null,
    deliveryInstructions: order.deliveryInstructions || null,
    trackingEmailConfigured: Boolean(proof(order)),
    items: [
      {
        name: order.listingTitle || 'Order item',
        quantity: order.quantity,
        image: order.listingImage || null
      }
    ],
    shipments: (dispatches.length ? dispatches : [null]).map((d) =>
      shipmentView(order, d, orderEvents)
    ),
    split: dispatches.length > 1,
    requests: (order.trackingRequests ?? []).map(
      ({ id, kind, message, shipmentId, status, createdAt, respondedAt }) => ({
        id,
        kind,
        message,
        shipmentId,
        status,
        createdAt,
        respondedAt: respondedAt || null
      })
    ),
    notificationCapabilities: { sms: false, email: false, push: false },
    updatedAt: [order.updatedAt, ...dispatches.map((d) => d.updatedAt)]
      .filter(Boolean)
      .sort()
      .at(-1),
    checkedAt: new Date().toISOString()
  };
}
