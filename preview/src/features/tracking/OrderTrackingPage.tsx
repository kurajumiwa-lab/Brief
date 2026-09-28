import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  ChevronDown,
  Info,
  Lock,
  MapPin,
  Package,
  Phone,
  RefreshCw,
  ShieldCheck,
  Truck,
  X
} from 'lucide-react';
import { WairoMark } from '../../components/WairoMark';
import * as api from '../../api/briefApi';
import type {
  DeliveryDetails,
  OrderTracking,
  TrackingAccess,
  TrackingRequestKind
} from '../../api/trackingTypes';
import './tracking.css';

export const requestLabels: Record<TrackingRequestKind, string> = {
  preferences: 'Update delivery preferences',
  neighbor: 'Leave with neighbor',
  hold: 'Hold at location',
  not_arrived: 'Package not arrived?',
  wrong_item: 'Wrong item delivered?',
  support: 'Contact support'
};
const date = (value?: string | null, full = false) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('en-KE', {
        day: 'numeric',
        month: 'short',
        year: full ? 'numeric' : undefined,
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: full ? 'short' : undefined
      }).format(new Date(value))
    : 'Not recorded';
const phoneLink = (value: string | null) =>
  value && /^\+?[\d\s()-]{7,24}$/.test(value)
    ? `tel:${value.replace(/[^+\d]/g, '')}`
    : undefined;
const imageSrc = (value: string | null) =>
  value && (/^\/[^/]/.test(value) || /^https:\/\//.test(value))
    ? value
    : undefined;

export default function OrderTrackingPage() {
  const initialOrder = useRef(
    new URLSearchParams(window.location.search).get('order')?.slice(0, 128) ||
      ''
  );
  const [number, setNumber] = useState(initialOrder.current),
    [email, setEmail] = useState('');
  const [access, setAccess] = useState<TrackingAccess | null>(null),
    [data, setData] = useState<OrderTracking | null>(null);
  const [selected, setSelected] = useState(''),
    [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [auto, setAuto] = useState(true);
  const [push, setPush] = useState(false),
    [pushMessage, setPushMessage] = useState('');
  const [request, setRequest] = useState<TrackingRequestKind | null>(null),
    [message, setMessage] = useState('');
  const [details, setDetails] = useState<DeliveryDetails>({
    email: '',
    address: '',
    instructions: ''
  });
  const heading = useRef<HTMLHeadingElement>(null),
    requestRef = useRef<HTMLDivElement>(null);
  const sequence = useRef(0),
    refreshingRef = useRef(false),
    requestKey = useRef('');
  const previous = useRef(''),
    pushRef = useRef(false),
    tokenRef = useRef<string | null>(null);
  const shipment =
    data?.shipments.find((s) => s.id === selected) || data?.shipments[0];
  const reset = useCallback(() => {
    sequence.current++;
    tokenRef.current = null;
    setAccess(null);
    setData(null);
    setEmail('');
    setMessage('');
    setRequest(null);
    setNotice('');
    setError('');
    setPush(false);
    setPushMessage('');
    setDetails({ email: '', address: '', instructions: '' });
    setBusy(false);
    setRefreshing(false);
  }, []);
  const accept = useCallback((value: TrackingAccess, focus = true) => {
    tokenRef.current = value.token;
    setAccess(value);
    setData(value.tracking);
    setSelected(value.tracking.shipments[0]?.id || '');
    setEmail('');
    setDetails({
      email: '',
      address: value.tracking.deliveryAddress || '',
      instructions: value.tracking.deliveryInstructions || ''
    });
    previous.current = JSON.stringify(
      value.tracking.shipments.map((s) => [s.id, s.status])
    );
    if (focus) window.setTimeout(() => heading.current?.focus(), 0);
  }, []);
  useEffect(() => {
    document.title = 'Track your order · Wairo Blue Avenue';
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.appendChild(meta);
    const robot = document.createElement('meta');
    robot.name = 'robots';
    robot.content = 'noindex, nofollow';
    document.head.appendChild(robot);
    window.addEventListener('brief:session-changed', reset);
    return () => {
      meta.remove();
      robot.remove();
      window.removeEventListener('brief:session-changed', reset);
      sequence.current++;
      tokenRef.current = null;
    };
  }, [reset]);
  useEffect(() => {
    if (!initialOrder.current || !api.getSessionToken()) return;
    const current = ++sequence.current;
    setBusy(true);
    api.getAccountTracking(initialOrder.current).then((result) => {
      if (current !== sequence.current) return;
      if (result.ok) accept(result.data);
      else setError(result.error);
      setBusy(false);
    });
  }, [accept]);
  useEffect(() => {
    pushRef.current = push;
  }, [push]);
  const refresh = useCallback(async () => {
    const token = tokenRef.current;
    if (
      !token ||
      refreshingRef.current ||
      document.visibilityState === 'hidden'
    )
      return;
    const current = sequence.current;
    refreshingRef.current = true;
    setRefreshing(true);
    const result = await api.readOrderTracking(token);
    refreshingRef.current = false;
    setRefreshing(false);
    if (token !== tokenRef.current || current !== sequence.current) return;
    if (result.ok) {
      const signature = JSON.stringify(
        result.data.tracking.shipments.map((s) => [s.id, s.status])
      );
      if (
        signature !== previous.current &&
        pushRef.current &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        try {
          new Notification('Wairo delivery update', {
            body: 'An order status has changed. Open your tracking page for the details.'
          });
        } catch {
          setPushMessage('This browser cannot show page notifications.');
          setPush(false);
        }
      }
      previous.current = signature;
      setData(result.data.tracking);
      setError('');
    } else {
      setError(result.error);
      if (result.status === 410) {
        tokenRef.current = null;
        setAccess(null);
        setData(null);
        setPush(false);
      }
    }
  }, []);
  useEffect(() => {
    if (!access || !auto) return;
    const timer = window.setInterval(() => void refresh(), 30000);
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', visible);
    };
  }, [access, auto, refresh]);
  useEffect(() => {
    if (!access) return;
    const timer = window.setTimeout(
      () => {
        reset();
        setError('Tracking access expired. Look up your order again.');
      },
      Math.max(0, Date.parse(access.expiresAt) - Date.now())
    );
    return () => clearTimeout(timer);
  }, [access, reset]);
  const lookup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const current = ++sequence.current;
    setBusy(true);
    setError('');
    setNotice('');
    const result = await api.lookupOrderTracking(number.trim(), email.trim());
    if (current !== sequence.current) return;
    if (result.ok) accept(result.data);
    else setError(result.error);
    setBusy(false);
  };
  const openRequest = (kind: TrackingRequestKind) => {
    setRequest(kind);
    setMessage('');
    setNotice('');
    requestKey.current = crypto.randomUUID();
    window.setTimeout(() => {
      requestRef.current?.scrollIntoView({ behavior: 'auto', block: 'center' });
      requestRef.current?.querySelector('textarea')?.focus();
    }, 0);
  };
  const submitRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!access || !request || busy) return;
    const current = ++sequence.current;
    const token = access.token;
    setBusy(true);
    setError('');
    const result = await api.sendTrackingRequest(token, {
      kind: request,
      message,
      shipmentId: shipment?.id === 'order' ? null : shipment?.id || null,
      key: requestKey.current
    });
    if (token !== tokenRef.current || current !== sequence.current) return;
    setBusy(false);
    if (result.ok) {
      setData(result.data.tracking);
      setRequest(null);
      setMessage('');
      setNotice(
        'Request sent to the seller. Delivery changes need confirmation; they are not carrier instructions yet.'
      );
    } else setError(result.error);
  };
  const saveDetails = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!data || busy) return;
    const current = ++sequence.current;
    setBusy(true);
    setError('');
    const result = await api.saveOrderDelivery(data.orderNumber, details);
    if (current !== sequence.current) return;
    setBusy(false);
    if (result.ok) {
      accept(result.data, false);
      setNotice(
        'Delivery details saved. Use this order number and tracking email for guest lookup.'
      );
    } else setError(result.error);
  };
  const respond = async (id: string, status: 'acknowledged' | 'declined') => {
    if (!data || busy) return;
    const current = ++sequence.current;
    setBusy(true);
    setError('');
    const result = await api.respondTrackingRequest(
      data.orderNumber,
      id,
      status
    );
    if (current !== sequence.current) return;
    setBusy(false);
    if (result.ok) {
      setData(result.data.tracking);
      setNotice('Response saved.');
    } else setError(result.error);
  };
  const optIn = async () => {
    if (push) {
      setPush(false);
      return;
    }
    if (!('Notification' in window) || !window.isSecureContext) {
      setPushMessage(
        'Browser notifications are not supported here. Keep this page open for updates.'
      );
      return;
    }
    const current = sequence.current;
    try {
      const permission = await Notification.requestPermission();
      if (current !== sequence.current || !tokenRef.current) return;
      setPush(permission === 'granted');
      setPushMessage(
        permission === 'granted'
          ? 'Enabled while this page is open and auto-refresh is on.'
          : 'Notifications were not enabled. You can change this in browser settings.'
      );
    } catch {
      setPushMessage('Notifications are unavailable in this browser.');
    }
  };
  return (
    <div className="wairo-tracking">
      <header className="track-nav">
        <a href="/#home" className="track-brand" aria-label="Wairo home">
          <WairoMark size={32} />
          <span>
            Wairo<small>BLUE AVENUE</small>
          </span>
        </a>
        <a href="/#spaces/orders" className="track-back">
          <ArrowLeft size={15} />
          <span>My orders</span>
        </a>
      </header>
      <main className="track-main">
        {!data ? (
          <>
            <section className="track-lookup-intro">
              <span className="track-eyebrow">
                <span /> FROM THE SELLER TO YOU
              </span>
              <h1>
                A little closer.
                <br />
                <em>Every step of the way.</em>
              </h1>
              <p>
                Your order’s journey, in one place. From the first confirmation
                to your doorstep—or your local stage.
              </p>
            </section>
            <div className="track-lookup-grid">
              <section className="track-card track-lookup">
                <div className="track-icon">
                  <Package size={24} />
                </div>
                <h2>Track your order</h2>
                <p>
                  No account needed. Use your order number and the email saved
                  for tracking.
                </p>
                <form onSubmit={lookup}>
                  <label>
                    Order number
                    <input
                      required
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      maxLength={128}
                      placeholder="e.g. ord_…"
                      value={number}
                      onChange={(e) => setNumber(e.target.value)}
                    />
                  </label>
                  <label>
                    Email address
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      maxLength={254}
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  <button className="track-primary" disabled={busy}>
                    {busy ? 'Looking up your order…' : 'Track order'}
                    <ArrowRight size={17} />
                  </button>
                </form>
                {error && (
                  <p className="track-error" role="alert">
                    {error}
                  </p>
                )}
                <p className="track-private">
                  <Lock size={14} /> Your order details stay private.
                </p>
              </section>
              <aside className="track-journey" aria-label="How tracking works">
                <div className="track-journey-art" aria-hidden="true">
                  <span className="track-art-orbit" />
                  <span className="track-art-point track-art-start">
                    <Package size={24} />
                  </span>
                  <span className="track-art-truck">
                    <Truck size={47} strokeWidth={1.5} />
                  </span>
                  <span className="track-art-point track-art-end">
                    <MapPin size={24} />
                  </span>
                  <span className="track-art-label">
                    GOOD THINGS. ON THEIR WAY.
                  </span>
                </div>
                <h2>
                  Across town.
                  <br />
                  Across counties.
                </h2>
                <p>
                  Follow seller-recorded updates for courier, rider and SACCO
                  deliveries. No guessing, just the latest available update.
                </p>
                <a href="#tracking-faq">
                  Need a hand finding your order? <ArrowRight size={15} />
                </a>
              </aside>
            </div>
          </>
        ) : (
          <>
            <div className="track-results-top">
              <div>
                <span className="track-eyebrow">YOUR ORDER’S JOURNEY</span>
                <h1 ref={heading} tabIndex={-1}>
                  Order tracking
                </h1>
                <p className="track-order-number">{data.orderNumber}</p>
                <p>
                  Placed {date(data.orderDate, true)} · {data.seller}
                </p>
              </div>
              <button className="track-text-button" onClick={reset}>
                <ArrowLeft size={15} /> Track another order
              </button>
            </div>
            {error && (
              <p className="track-error" role="alert">
                {error} {data && 'The last successful update is shown below.'}
              </p>
            )}
            {notice && (
              <p className="track-notice" role="status">
                {notice}
              </p>
            )}
            {data.split && (
              <div className="track-shipments" aria-label="Choose shipment">
                {data.shipments.map((s, i) => (
                  <button
                    key={s.id}
                    className={shipment?.id === s.id ? 'active' : ''}
                    aria-pressed={shipment?.id === s.id}
                    onClick={() => {
                      setSelected(s.id);
                      setRequest(null);
                      setNotice('');
                    }}
                  >
                    <Package size={17} />
                    <span>
                      Shipment {i + 1} of {data.shipments.length}
                      <small>{s.label}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {shipment && (
              <div className="track-results-grid">
                <div className="track-primary-column">
                  <section
                    className={`track-status ${['cancelled', 'disputed'].includes(shipment.status) ? 'track-status-warning' : ''}`}
                    aria-labelledby="shipment-status"
                  >
                    <div className="track-status-symbol">
                      {['collected', 'delivered', 'fulfilled'].includes(
                        shipment.status
                      ) ? (
                        <Check size={30} />
                      ) : (
                        <Truck size={30} />
                      )}
                    </div>
                    <div>
                      <span className="track-eyebrow">
                        {shipment.mode === 'stage'
                          ? 'STAGE PICKUP'
                          : shipment.id === 'order'
                            ? 'ORDER UPDATE'
                            : 'DOOR DELIVERY'}
                      </span>
                      <h2 id="shipment-status">{shipment.label}</h2>
                      <p>{shipment.description}</p>
                    </div>
                    <div className="track-estimate">
                      <span>
                        Estimated{' '}
                        {shipment.mode === 'stage'
                          ? 'arrival at stage'
                          : 'delivery'}
                      </span>
                      <strong>
                        {shipment.estimatedDelivery
                          ? date(shipment.estimatedDelivery, true)
                          : 'Awaiting an estimate'}
                      </strong>
                      <small>
                        {shipment.estimatedDelivery
                          ? 'Seller-provided estimate · not guaranteed'
                          : 'The seller hasn’t provided a delivery time yet.'}
                      </small>
                    </div>
                    {shipment.carrier && (
                      <p className="track-mobile-carrier">
                        {shipment.carrier}
                        {shipment.trackingNumber && (
                          <span>{shipment.trackingNumber}</span>
                        )}
                      </p>
                    )}
                  </section>
                  <section className="track-card track-progress">
                    <div className="track-section-heading">
                      <h2>Every step, at a glance</h2>
                      <span className="track-pill">
                        {data.split
                          ? `Shipment ${data.shipments.indexOf(shipment) + 1}`
                          : 'Your journey'}
                      </span>
                    </div>
                    <ol className="track-timeline">
                      {shipment.timeline.map((step) => (
                        <li
                          key={step.id}
                          className={`${step.current ? 'current' : ''} ${step.completed ? 'complete' : ''}`}
                          aria-current={step.current ? 'step' : undefined}
                        >
                          <span className="track-step-icon" aria-hidden="true">
                            {step.current ? (
                              <Truck size={19} />
                            ) : step.completed ? (
                              <Check size={15} />
                            ) : (
                              <span />
                            )}
                          </span>
                          <div>
                            <h3>
                              {step.label}
                              {step.current && <span>Current</span>}
                            </h3>
                            <p>
                              {step.at
                                ? date(step.at, true)
                                : step.completed
                                  ? 'Time not recorded'
                                  : 'No update recorded'}
                            </p>
                            {step.location && (
                              <p className="track-step-location">
                                <MapPin size={12} />
                                {step.location}
                              </p>
                            )}
                            {step.current && (
                              <p className="track-current-note">
                                {shipment.description}
                              </p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                    <p className="track-footnote">
                      Only recorded milestones receive a checkmark. Times are
                      shown in your local time zone.
                    </p>
                    <details className="track-history" key={shipment.id}>
                      <summary>
                        View complete tracking history <ChevronDown size={17} />
                      </summary>
                      <ol>
                        {shipment.events.map((event, i) => (
                          <li key={`${event.status}-${event.at}-${i}`}>
                            <span className="track-history-dot" />
                            <div>
                              <strong>{event.label}</strong>
                              <time>{date(event.at, true)}</time>
                              {event.location && <p>{event.location}</p>}
                              <small>{event.source}</small>
                            </div>
                          </li>
                        ))}
                      </ol>
                    </details>
                    <div className="track-refresh">
                      <span>
                        <span
                          className={`track-live-dot ${auto ? 'on' : ''}`}
                        />
                        {auto
                          ? 'Checks every 30 seconds'
                          : 'Auto-refresh paused'}
                        <small>Last checked {date(data.checkedAt)}</small>
                      </span>
                      <button
                        aria-label="Refresh tracking"
                        disabled={refreshing || busy}
                        onClick={() => void refresh()}
                      >
                        <RefreshCw
                          size={16}
                          className={refreshing ? 'track-spinning' : ''}
                        />
                      </button>
                    </div>
                  </section>
                  <section className="track-card">
                    <div className="track-section-heading">
                      <h2>Delivery details</h2>
                      <MapPin size={19} />
                    </div>
                    <dl className="track-delivery">
                      <div>
                        <dt>
                          {shipment.mode === 'stage'
                            ? 'Destination stage / town'
                            : 'Delivery address'}
                        </dt>
                        <dd>
                          {shipment.mode === 'stage'
                            ? shipment.destination || 'Not provided'
                            : data.deliveryAddress ||
                              shipment.destination ||
                              'Not provided yet'}
                        </dd>
                      </div>
                      {shipment.mode === 'door' && shipment.destination && (
                        <div>
                          <dt>Shipment destination</dt>
                          <dd>{shipment.destination}</dd>
                        </div>
                      )}
                      {shipment.mode === 'stage' && data.deliveryAddress && (
                        <div>
                          <dt>Address supplied with order</dt>
                          <dd>{data.deliveryAddress}</dd>
                        </div>
                      )}
                      <div>
                        <dt>Delivery instructions</dt>
                        <dd>
                          {data.deliveryInstructions ||
                            'No special instructions saved.'}
                        </dd>
                      </div>
                      {shipment.lastLocation && (
                        <div>
                          <dt>Last reported location</dt>
                          <dd>
                            {shipment.lastLocation}
                            <small>
                              Seller-reported location, not live GPS.
                            </small>
                          </dd>
                        </div>
                      )}
                    </dl>
                    <div className="track-preferences">
                      <button
                        disabled={
                          !shipment.canRequestPreferences ||
                          busy ||
                          access?.canRespond
                        }
                        onClick={() => openRequest('preferences')}
                      >
                        Update delivery preferences <ArrowRight size={15} />
                      </button>
                      <div>
                        <button
                          disabled={
                            !shipment.canRequestPreferences ||
                            busy ||
                            access?.canRespond
                          }
                          onClick={() => openRequest('neighbor')}
                        >
                          Leave with neighbor
                        </button>
                        <button
                          disabled={
                            !shipment.canRequestPreferences ||
                            busy ||
                            access?.canRespond
                          }
                          onClick={() => openRequest('hold')}
                        >
                          Hold at location
                        </button>
                      </div>
                      <small>
                        Requests go to your seller. Availability depends on the
                        carrier; changes need confirmation.
                      </small>
                    </div>
                    {access?.canManage &&
                      shipment.id === 'order' &&
                      ![
                        'fulfilled',
                        'settled',
                        'cancelled',
                        'disputed'
                      ].includes(data.orderStatus) && (
                        <details className="track-details-form">
                          <summary>
                            {data.trackingEmailConfigured
                              ? 'Edit address & tracking email'
                              : 'Set up guest tracking'}
                          </summary>
                          <p>
                            Add an email to let you look up this order without
                            signing in. Keep your order number private.
                          </p>
                          <form onSubmit={saveDetails}>
                            <label>
                              Tracking email
                              <input
                                type="email"
                                required
                                maxLength={254}
                                value={details.email}
                                onChange={(e) =>
                                  setDetails({
                                    ...details,
                                    email: e.target.value
                                  })
                                }
                              />
                            </label>
                            <label>
                              Delivery address
                              <textarea
                                maxLength={500}
                                value={details.address}
                                onChange={(e) =>
                                  setDetails({
                                    ...details,
                                    address: e.target.value
                                  })
                                }
                              />
                            </label>
                            <label>
                              Delivery instructions
                              <textarea
                                maxLength={500}
                                value={details.instructions}
                                onChange={(e) =>
                                  setDetails({
                                    ...details,
                                    instructions: e.target.value
                                  })
                                }
                              />
                            </label>
                            <button className="track-primary" disabled={busy}>
                              Save delivery details
                            </button>
                          </form>
                        </details>
                      )}
                  </section>
                  {request && (
                    <section
                      className="track-card track-request"
                      ref={requestRef}
                    >
                      <div className="track-section-heading">
                        <h2>{requestLabels[request]}</h2>
                        <button
                          aria-label="Close request"
                          disabled={busy}
                          onClick={() => setRequest(null)}
                        >
                          <X size={19} />
                        </button>
                      </div>
                      <p>
                        Your message will appear in {data.seller}’s order
                        tracking view.
                        {shipment.id !== 'order' &&
                          ` For shipment ${data.shipments.indexOf(shipment) + 1}.`}
                      </p>
                      <form onSubmit={submitRequest}>
                        <label>
                          Details for the seller
                          <textarea
                            required
                            minLength={3}
                            maxLength={500}
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            placeholder={
                              request === 'neighbor'
                                ? 'Neighbor’s name, location and permission to receive…'
                                : request === 'hold'
                                  ? 'Preferred pickup location and collection date…'
                                  : 'How can the seller help?'
                            }
                          />
                        </label>
                        <button className="track-primary" disabled={busy}>
                          {busy ? 'Sending…' : 'Send request'}
                          <ArrowRight size={16} />
                        </button>
                      </form>
                    </section>
                  )}
                  {data.requests.some(
                    (r) => !r.shipmentId || r.shipmentId === shipment.id
                  ) && (
                    <section className="track-card">
                      <h2>Requests & support</h2>
                      <ul className="track-requests">
                        {data.requests
                          .filter(
                            (r) => !r.shipmentId || r.shipmentId === shipment.id
                          )
                          .slice()
                          .reverse()
                          .map((r) => (
                            <li key={r.id}>
                              <div>
                                <strong>{requestLabels[r.kind]}</strong>
                                <span className="track-pill">
                                  {r.status === 'requested'
                                    ? 'Awaiting seller'
                                    : r.status === 'acknowledged'
                                      ? 'Seller acknowledged'
                                      : 'Seller declined'}
                                </span>
                              </div>
                              <p>{r.message}</p>
                              <small>{date(r.createdAt, true)}</small>
                              {access?.canRespond &&
                                r.status === 'requested' && (
                                  <div className="track-response">
                                    <button
                                      disabled={busy}
                                      onClick={() =>
                                        void respond(r.id, 'acknowledged')
                                      }
                                    >
                                      Acknowledge
                                    </button>
                                    <button
                                      disabled={busy}
                                      onClick={() =>
                                        void respond(r.id, 'declined')
                                      }
                                    >
                                      Decline
                                    </button>
                                  </div>
                                )}
                            </li>
                          ))}
                      </ul>
                      <p className="track-footnote">
                        An acknowledgment is not a carrier confirmation or a
                        refund.
                      </p>
                    </section>
                  )}
                </div>
                <aside className="track-secondary-column">
                  <section className="track-card track-carrier">
                    <div className="track-section-heading">
                      <h2>With your carrier</h2>
                      <Truck size={19} />
                    </div>
                    <strong>{shipment.carrier || 'Not assigned yet'}</strong>
                    <span className="track-subtitle">
                      {shipment.trackingReferenceKind === 'wairo'
                        ? 'Wairo dispatch reference'
                        : 'Waybill / tracking number'}
                    </span>
                    <code>
                      {shipment.trackingNumber || 'Available after dispatch'}
                    </code>
                    {shipment.carrierContact ? (
                      <p>
                        {phoneLink(shipment.carrierContact) ? (
                          <a
                            className="track-call"
                            href={phoneLink(shipment.carrierContact)}
                          >
                            <Phone size={15} /> Contact carrier
                          </a>
                        ) : (
                          'Carrier contact'
                        )}
                        <small>{shipment.carrierContact}</small>
                      </p>
                    ) : (
                      <p className="track-footnote">
                        Carrier contact details haven’t been provided.
                      </p>
                    )}
                  </section>
                  <section className="track-card">
                    <div className="track-section-heading">
                      <h2>{data.split ? 'Order contents' : 'What’s inside'}</h2>
                      <Package size={19} />
                    </div>
                    {data.items.map((item, i) => (
                      <div className="track-item" key={i}>
                        <span className="track-item-image">
                          {imageSrc(item.image) ? (
                            <img
                              src={api.mediaFileUrl(imageSrc(item.image)!)}
                              alt=""
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                          ) : (
                            <Package size={26} />
                          )}
                        </span>
                        <div>
                          <strong>{item.name}</strong>
                          <small>
                            {shipment.quantity !== null
                              ? `Qty ${shipment.quantity} in this shipment`
                              : `Qty ${item.quantity}${data.split ? ' in the full order' : ''}`}
                          </small>
                        </div>
                      </div>
                    ))}
                    {data.split && shipment.quantity === null && (
                      <p className="track-footnote">
                        The seller hasn’t specified how the items are divided
                        between shipments.
                      </p>
                    )}
                  </section>
                  <section className="track-card">
                    <div className="track-section-heading">
                      <h2>Stay in the loop</h2>
                      <Bell size={19} />
                    </div>
                    <label className="track-toggle-row">
                      <span>
                        Auto-refresh<small>While this page is open</small>
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={auto}
                        onChange={(e) => setAuto(e.target.checked)}
                      />
                    </label>
                    <label className="track-toggle-row">
                      <span>
                        SMS updates<small>Delivery SMS isn’t connected</small>
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        disabled
                        checked={false}
                        readOnly
                      />
                    </label>
                    <label className="track-toggle-row">
                      <span>
                        Email updates
                        <small>Delivery email isn’t connected</small>
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        disabled
                        checked={false}
                        readOnly
                      />
                    </label>
                    <button
                      className="track-push"
                      onClick={() => void optIn()}
                      aria-pressed={push}
                    >
                      <Bell size={15} />
                      {push
                        ? 'Turn off browser alerts'
                        : 'Enable browser alerts'}
                    </button>
                    <p className="track-footnote" role="status">
                      {pushMessage ||
                        'Alerts work only while this page is open and auto-refresh is on. Background push isn’t connected.'}
                    </p>
                  </section>
                  <section className="track-card track-help">
                    <div className="track-section-heading">
                      <h2>A little help?</h2>
                      <Info size={19} />
                    </div>
                    {(['not_arrived', 'wrong_item', 'support'] as const).map(
                      (kind) => (
                        <button
                          key={kind}
                          disabled={busy || access?.canRespond}
                          onClick={() => openRequest(kind)}
                        >
                          {requestLabels[kind]}
                          <ArrowRight size={15} />
                        </button>
                      )
                    )}
                    <a href="#tracking-faq">
                      Tracking FAQs
                      <ArrowRight size={15} />
                    </a>
                    {data.sellerContact && (
                      <p className="track-footnote">
                        Seller contact: {data.sellerContact}
                      </p>
                    )}
                    <p className="track-footnote">
                      Support requests go to the seller. For a formal dispute,{' '}
                      <a href="/#spaces/orders">open your orders</a>.
                    </p>
                  </section>
                </aside>
              </div>
            )}
          </>
        )}
        <section id="tracking-faq" className="track-faq">
          <span className="track-eyebrow">GOOD TO KNOW</span>
          <h2>A few useful answers.</h2>
          <details>
            <summary>
              Where do I find my order number and email?
              <ChevronDown size={17} />
            </summary>
            <p>
              Find your order number in <a href="/#spaces/orders">My orders</a>.
              Use the email you saved for tracking, or your account email if one
              was available when you ordered. If you don’t have a tracking
              email, sign in, open Track order and add one before dispatch. For
              an older dispatched order without an email, track it while signed
              in or contact your seller.
            </p>
          </details>
          <details>
            <summary>
              Why hasn’t my tracking changed?
              <ChevronDown size={17} />
            </summary>
            <p>
              This page shows updates recorded by your seller. It checks for
              changes every 30 seconds while visible, but it isn’t a live
              carrier feed. Missing steps stay unconfirmed, and an estimate is
              never a guarantee. Use “Package not arrived?” to send the seller a
              message.
            </p>
          </details>
          <details>
            <summary>
              How do stage pickup and delivery changes work?
              <ChevronDown size={17} />
            </summary>
            <p>
              SACCO parcels often arrive at a destination stage for collection
              rather than at your door. Wait for “Ready at stage” and confirm
              the waybill and pickup location with your carrier. Neighbor and
              hold requests are subject to the seller and carrier’s
              confirmation.
            </p>
          </details>
          <details>
            <summary>
              Is my order paid?
              <ChevronDown size={17} />
            </summary>
            <p>
              Dispatch and delivery don’t confirm payment. Check your order’s
              payment record in <a href="/#spaces/orders">My orders</a>.
              Tracking requests do not charge you, settle a payment or issue a
              refund.
            </p>
          </details>
        </section>
        <footer className="track-footer">
          <span>
            <ShieldCheck size={16} /> A clearer journey, with Wairo.
          </span>
          <a href="/#home">
            Back to Wairo <ArrowRight size={14} />
          </a>
        </footer>
      </main>
    </div>
  );
}
