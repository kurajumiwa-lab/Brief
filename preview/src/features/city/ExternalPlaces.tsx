import React, { useRef, useState } from 'react';
import * as briefApi from '../../api/briefApi';
import type { ExternalPlace, PlacePriceClaim, PlaceSnapshot } from '../../api/types';
import { ImageField } from '../../components/ImageField';
import { soundEngine } from '../../utils/SoundEngine';

// ---------------------------------------------------------------------------
// EXTERNAL PLACES — map listings a seeker can find on the way to a task.
//
// Source: the business directory (OpenStreetMap via BizData). These are NOT
// registered shops: Brief did not verify them, they cannot take orders, and
// they carry no prices. What a courier CAN do: take the location, complete
// the pickup, and — if the price on the ground differs — attach a RECEIPT
// PHOTO with the claimed price. A price without a receipt is refused, and
// every claim stays labelled unverified until a second, independent receipt
// confirms it (a later phase; this file does not pretend it exists).
//
// No image scanner is built here on purpose: the photo IS the evidence, and
// any future OCR reads the same photos this phase stores.
// ---------------------------------------------------------------------------

const CATEGORIES = [
  'accountant', 'bakery', 'bank', 'bar', 'beauty', 'bookstore', 'cafe',
  'car_dealer', 'car_repair', 'cinema', 'clothing', 'coworking', 'dentist',
  'doctor', 'electronics', 'florist', 'furniture', 'gallery', 'gas_station',
  'guest_house', 'gym', 'hairdresser', 'hospital', 'hostel', 'hotel',
  'insurance', 'lawyer', 'museum', 'parking', 'pet_shop', 'pharmacy',
  'real_estate', 'restaurant', 'school', 'supermarket', 'theatre', 'university'
];

const words = (s: string) => s.replace(/_/g, ' ');
const placeKeyOf = (p: ExternalPlace) =>
  p.osmId ?? `${p.name}|${p.lat ?? ''},${p.lon ?? ''}`;
const coordsOf = (p: ExternalPlace) =>
  p.lat !== null && p.lon !== null ? `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}` : null;

function ClaimForm({
  place,
  snapshot,
  onSaved
}: {
  place: ExternalPlace;
  snapshot: PlaceSnapshot;
  onSaved: (claim: PlacePriceClaim) => void;
}) {
  const [receipt, setReceipt] = useState<string | null>(null);
  const [item, setItem] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const keyRef = useRef('');
  if (!keyRef.current)
    keyRef.current = `pclaim-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const save = async () => {
    setMsg('');
    if (!receipt) { setMsg('Photograph the receipt first — no photo, no claim.'); return; }
    if (item.trim().length < 2) { setMsg('Say what the price is for.'); return; }
    const n = Number(amount.trim());
    if (!Number.isInteger(n) || n <= 0) { setMsg('Type whole shillings above zero.'); return; }
    setBusy(true);
    const r = await briefApi.claimPlacePrice({
      placeKey: placeKeyOf(place),
      placeName: place.name,
      location: snapshot.locationResolved,
      category: place.category || snapshot.category,
      item: item.trim(),
      amountKes: n,
      receiptPhoto: receipt,
      idempotencyKey: keyRef.current
    });
    setBusy(false);
    if (!r.ok) { setMsg(r.error ?? 'That did not go through.'); return; }
    keyRef.current = `pclaim-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    setReceipt(null);
    setItem('');
    setAmount('');
    onSaved(r.data.claim);
  };

  return (
    <div className="space-y-2 pt-2">
      <ImageField
        label="Receipt photo"
        hint="Photograph the receipt at the till. The photo is the proof — without it there is no claim."
        value={receipt}
        onChange={setReceipt}
        compact
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          className="brief-lobby-input" aria-label="What the price is for" placeholder="Item on the receipt"
          value={item} onChange={(e) => setItem(e.target.value)} maxLength={120}
        />
        <input
          className="brief-lobby-input" aria-label="Price in shillings" placeholder="KES, whole shillings"
          value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric"
        />
      </div>
      <button type="button" disabled={busy} className="brief-lobby-btn brief-lobby-btn--primary" onClick={() => void save()}>
        {busy ? 'Saving…' : 'Attach receipt + price'}
      </button>
      {msg && <p role={msg.startsWith('Claim saved') ? 'status' : 'alert'} className="text-[12px] font-bold" style={{ color: msg.startsWith('Claim saved') ? 'var(--color-success)' : 'var(--color-danger)' }}>{msg}</p>}
      <p className="text-[11px]" style={{ color: 'rgba(13,27,42,0.6)' }}>
        Saved claims stay unverified and show the photo, so the next carrier judges the evidence, not the number.
      </p>
    </div>
  );
}

function PlaceCard({
  place,
  snapshot,
  onSelectPlace
}: {
  place: ExternalPlace;
  snapshot: PlaceSnapshot;
  onSelectPlace?: (label: string, place: ExternalPlace) => void;
}) {
  const [open, setOpen] = useState(false);
  const [claims, setClaims] = useState<PlacePriceClaim[] | null>(null);
  const [loadingClaims, setLoadingClaims] = useState(false);
  const [claimsError, setClaimsError] = useState('');
  const coords = coordsOf(place);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && claims === null) {
      setLoadingClaims(true);
      setClaimsError('');
      const r = await briefApi.listPlacePriceClaims(placeKeyOf(place));
      setLoadingClaims(false);
      if (r.ok) setClaims(r.data.claims);
      else setClaimsError(r.error ?? 'Claims could not be read.');
    }
  };

  const field = (label: string, value: string) => (
    <p className="text-[12px]" style={{ color: 'rgba(13,27,42,0.72)' }}>
      <span className="font-bold">{label}: </span>
      {value.trim() !== '' ? value : <span style={{ color: 'rgba(13,27,42,0.45)' }}>Not listed</span>}
    </p>
  );

  return (
    <div className="brief-lobby-card p-3.5 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[15px] font-black leading-snug" style={{ color: 'var(--brief-ink)' }}>{place.name}</p>
        <span className="shrink-0 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full" style={{ background: 'var(--color-well)', color: 'var(--brief-muted)' }}>
          Map listing
        </span>
      </div>
      <p className="text-[12px] font-bold" style={{ color: 'var(--color-primary)' }}>
        {words(place.category || snapshot.category)}{coords ? ` · ${coords}` : ''}
      </p>
      {field('Address', place.address)}
      {field('Phone', place.phone)}
      {field('Hours', place.openingHours)}
      {place.website.trim() !== '' && (
        <a href={place.website} target="_blank" rel="noreferrer" className="text-[12px] font-bold" style={{ color: 'var(--color-primary)' }}>
          Their site
        </a>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        {onSelectPlace && (
          <button
            type="button" className="brief-lobby-btn brief-lobby-btn--primary"
            onClick={() => { soundEngine.play('tap'); onSelectPlace(`${place.name}${coords ? ` (${coords})` : ''}`, place); }}
          >
            Use as pickup point
          </button>
        )}
        <button type="button" className="brief-lobby-btn brief-lobby-btn--quiet" onClick={() => void toggle()}>
          {open ? 'Hide prices' : `Prices${claims !== null ? ` (${claims.length})` : ''}`}
        </button>
      </div>
      {open && (
        <div className="pt-1 space-y-2">
          {loadingClaims && <p className="text-[12px]">Reading claims…</p>}
          {claimsError && <p role="alert" className="text-[12px] font-bold" style={{ color: 'var(--color-danger)' }}>{claimsError}</p>}
          {claims !== null && claims.length === 0 && (
            <p className="text-[12px]" style={{ color: 'rgba(13,27,42,0.6)' }}>
              No claimed prices yet. The first one needs a receipt photo.
            </p>
          )}
          {claims !== null && claims.map((c) => (
            <div key={c.id} className="flex items-center gap-2.5 p-2 rounded-xl" style={{ background: 'var(--color-well)' }}>
              <img src={briefApi.mediaFileUrl(c.receiptPhoto)} alt="Receipt" className="w-11 h-11 rounded-lg object-cover shrink-0" />
              <div className="min-w-0">
                <p className="text-[13px] font-bold truncate" style={{ color: 'var(--brief-ink)' }}>
                  {c.item} · KES {c.amountKes.toLocaleString('en-KE')}
                </p>
                <p className="text-[11px]" style={{ color: 'var(--brief-muted)' }}>
                  Claimed {new Date(c.createdAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })} · unverified — judge the photo
                </p>
              </div>
            </div>
          ))}
          <ClaimForm place={place} snapshot={snapshot} onSaved={(c) => setClaims((prev) => (prev ? [c, ...prev] : [c]))} />
        </div>
      )}
    </div>
  );
}

export function ExternalPlaces({
  onSelectPlace,
  className = ''
}: {
  onSelectPlace?: (label: string, place: ExternalPlace) => void;
  className?: string;
}) {
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('supermarket');
  const [snapshot, setSnapshot] = useState<PlaceSnapshot | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  const search = async () => {
    setError('');
    if (location.trim().length < 2) { setError('Type a town or area first — the directory is not searched on a guess.'); return; }
    setSearching(true);
    const r = await briefApi.searchExternalPlaces(location.trim(), category, 10);
    setSearching(false);
    if (!r.ok) { setError(r.error ?? 'The directory could not be reached.'); return; }
    soundEngine.play('tap');
    setSnapshot(r.data.snapshot);
  };

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="brief-lobby-card p-4 space-y-2.5">
        <p className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: 'var(--color-primary)' }}>
          Find a pickup point
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            className="brief-lobby-input" aria-label="Town or area" placeholder="Town or area (e.g. Nairobi)"
            value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120}
          />
          <select
            className="brief-lobby-input" aria-label="Category" value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map((c) => <option key={c} value={c}>{words(c)}</option>)}
          </select>
        </div>
        <button type="button" disabled={searching} className="brief-lobby-btn brief-lobby-btn--primary w-full disabled:opacity-50" onClick={() => void search()}>
          {searching ? 'Searching the map…' : 'Search the map'}
        </button>
        {error && <p role="alert" className="text-[12px] font-bold" style={{ color: 'var(--color-danger)' }}>{error}</p>}
        <p className="text-[11px]" style={{ color: 'rgba(13,27,42,0.6)' }}>
          Map listings, not registered shops. Brief did not verify them — that is why prices only arrive as receipt photos.
        </p>
      </div>

      {snapshot && (
        <div className="space-y-2.5">
          <div className="space-y-0.5">
            <p className="text-[13px] font-bold" style={{ color: 'var(--brief-ink)' }}>
              {snapshot.total !== null ? `${snapshot.total} found near ${snapshot.locationResolved} · showing ${snapshot.businesses.length}` : `Showing ${snapshot.businesses.length} near ${snapshot.locationResolved}`}
            </p>
            <p className="text-[11px]" style={{ color: 'var(--brief-muted)' }}>
              {snapshot.attribution} · fetched {new Date(snapshot.fetchedAt).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              {snapshot.stale ? ' · directory unreachable — showing the last saved answer' : ''}
            </p>
          </div>
          {snapshot.businesses.length === 0 && (
            <div className="brief-lobby-card p-4">
              <p className="text-[13px] font-bold">Nothing on the map for that search.</p>
              <p className="text-[12px]" style={{ color: 'rgba(13,27,42,0.6)' }}>Try a bigger town nearby, or another category.</p>
            </div>
          )}
          {snapshot.businesses.map((p, i) => (
            <PlaceCard key={p.osmId ?? `${p.name}-${i}`} place={p} snapshot={snapshot} onSelectPlace={onSelectPlace} />
          ))}
        </div>
      )}
    </div>
  );
}

export default ExternalPlaces;
