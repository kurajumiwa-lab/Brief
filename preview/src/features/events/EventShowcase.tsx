import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Share2, Ticket, MapPin, Sparkles, ChevronDown,
  Clock, Check, ExternalLink,
} from 'lucide-react';
import * as briefApi from '../../api/briefApi';
import type { PublicCampaignContext } from '../../api/briefApi';
import type {
  PublicCampaign, Festival, FestivalPriceTier
} from '../../api/types';
import { WairoMark } from '../../components/WairoMark';
import { soundEngine } from '../../utils/SoundEngine';

// ---------------------------------------------------------------------------
// EVENT SHOWCASE — the festival-style page for a Wairo event.
//
// It renders a REAL campaign in a bold, energetic StreetBite-style layout:
// hero, lineup, map/zones, schedule, tickets, music, sponsors, FAQ, final CTA,
// footer. The rule it obeys: every section renders only rows the organiser
// actually stated (or the campaign's own real fields). There are no food
// photos (none are uploaded), no invented attendance or star ratings, no
// "sold out 2 weeks early" line, no fake sponsor logos, and no Spotify embeds
// (no real embed ids). A section with no rows simply does not render.
//
// The one real capability preserved from the event page: registering for a
// ticket (name + contact → a real ticket code from the server).
// ---------------------------------------------------------------------------

const ROSE = '#E11D48';
const ORANGE = '#F97316';
const YELLOW = '#FEF08A';
const ROSE_TINT = '#FEF2F2';
const DARK = '#1C1917';

const money = (n: number, c: string) => `${c} ${Number(n).toLocaleString('en-KE')}`;

function fmtDay(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' });
}
function dateRange(startsAt: string | null, endsAt: string | null): string | null {
  const a = fmtDay(startsAt);
  const b = fmtDay(endsAt);
  if (a && b && a !== b) return `${a} – ${b}`;
  return a ?? null;
}
function mapsHref(lat?: number | null, lng?: number | null, q?: string | null): string | null {
  if (typeof lat === 'number' && typeof lng === 'number') {
    return `https://www.google.com/maps?q=${lat},${lng}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  }
  if (q) return `https://www.google.com/maps/search/${encodeURIComponent(q)}`;
  return null;
}

const Accordion: React.FC<{ q: string; a: string | null | undefined; open: boolean; onToggle: () => void }> = ({ q, a, open, onToggle }) => (
  <div className="border-b" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
    <button type="button" onClick={onToggle} className="w-full flex items-center justify-between gap-3 py-4 text-left cursor-pointer">
      <span className="text-[15px] font-bold" style={{ color: DARK }}>{q}</span>
      <ChevronDown className={`w-5 h-5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: ROSE }} />
    </button>
    {open && <p className="pb-4 text-[14px] leading-relaxed" style={{ color: 'rgba(28,25,23,0.72)' }}>{a || '—'}</p>}
  </div>
);

export const EventShowcase: React.FC<{ slug: string; onBack?: () => void }> = ({ slug, onBack }) => {
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [campaign, setCampaign] = useState<PublicCampaign | null>(null);
  const [ctx, setCtx] = useState<PublicCampaignContext | null>(null);

  const [regOpen, setRegOpen] = useState(false);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<{ code: string | null; status: string } | null>(null);

  const [lineupTag, setLineupTag] = useState<string>('All');
  const [scheduleDay, setScheduleDay] = useState(0);
  const [faqOpen, setFaqOpen] = useState<number | null>(0);

  useEffect(() => {
    let live = true;
    setStatus('loading');
    void briefApi.getPublicCampaign(slug).then((res) => {
      if (!live) return;
      if (res.ok) { setCampaign(res.data); setStatus('ready'); }
      else setStatus('error');
    });
    void briefApi.getPublicCampaignContext(slug).then((res) => { if (live && res.ok) setCtx(res.data); });
    return () => { live = false; };
  }, [slug]);

  const festival: Festival | null = campaign?.festival ?? null;

  const lineupTags = useMemo(() => {
    const tags = new Set<string>();
    (festival?.lineup ?? []).forEach((l) => { if (l.tag) tags.add(l.tag); });
    return ['All', ...Array.from(tags)];
  }, [festival]);
  const lineup = useMemo(
    () => (festival?.lineup ?? []).filter((l) => lineupTag === 'All' || l.tag === lineupTag),
    [festival, lineupTag],
  );

  const go = (hash: string) => { soundEngine.play('tap'); window.location.hash = hash; };
  const scrollToTickets = () => document.getElementById('ev-tickets')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const share = async () => {
    const url = window.location.href;
    try { await navigator.clipboard?.writeText(url); setTicket((t) => t ?? t); } catch { /* no-op */ }
    try {
      if (navigator.share) await navigator.share({ title: campaign?.title, url });
      else { await navigator.clipboard?.writeText(url); window.alert('Link copied to your clipboard.'); }
    } catch { /* cancelled */ }
  };

  const submit = async () => {
    if (!campaign) return;
    setBusy(true);
    setRegError(null);
    const attendeeRef = contact.trim() !== '' ? contact.trim() : `guest-${Math.random().toString(36).slice(2, 10)}`;
    const res = await briefApi.registerForCampaign(slug, {
      attendeeRef,
      name: name.trim() || undefined,
      contact: contact.trim() || undefined,
      amount: amount.trim() === '' ? undefined : Number(amount),
    });
    setBusy(false);
    if (res.ok) {
      setTicket({ code: res.data.registration.ticketCode ?? null, status: res.data.registration.status });
      setCampaign(res.data.campaign);
    } else {
      setRegError(res.status === 401 ? 'Sign in to get a ticket — tickets need an account.' : res.error ?? 'That did not go through.');
    }
  };

  if (status === 'loading') {
    return <div className="min-h-screen grid place-items-center" style={{ background: '#fff' }}><p className="text-sm" style={{ color: 'rgba(28,25,23,0.6)' }}>Loading the event…</p></div>;
  }
  if (status === 'error' || !campaign) {
    return (
      <div className="min-h-screen grid place-items-center px-6 text-center" style={{ background: '#fff' }}>
        <div>
          <p className="text-[20px] font-black" style={{ color: DARK }}>This event is not available.</p>
          <p className="text-[14px] mt-2" style={{ color: 'rgba(28,25,23,0.6)' }}>It may be private, closed, or the link is wrong.</p>
          {onBack && <button type="button" onClick={onBack} className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-[14px] font-bold cursor-pointer" style={{ background: ROSE, color: '#fff' }}><ArrowLeft className="w-4 h-4" /> Back to the street</button>}
        </div>
      </div>
    );
  }

  const venue = campaign.venue ?? null;
  const locationText = [venue?.name ?? campaign.location, venue?.address].filter(Boolean).join(', ') || null;
  const range = dateRange(campaign.startsAt, campaign.endsAt);
  const priceLabel = campaign.price === 0 ? 'Free entry' : money(campaign.price, campaign.currency);
  const maps = mapsHref(venue?.lat ?? null, venue?.lng ?? null, locationText ?? campaign.title);
  const schedules = festival?.daySchedules ?? null;
  const currentSchedule = schedules && schedules.length > 0 ? schedules[Math.min(scheduleDay, schedules.length - 1)] : null;
  const hasFestivalContent = Boolean(festival && Object.keys(festival).length > 0);
  const inclusions = festival?.inclusions ?? [];
  const unlisted = Boolean(campaign.unlisted);
  const teamLeft = campaign.capacity != null
    ? (campaign.soldOut ? 'full' : campaign.remaining != null ? `${campaign.remaining} of ${campaign.capacity} spots left` : `${campaign.capacity} spots`)
    : null;
  const perPerson = campaign.price > 0 ? 'Per person' : 'Free to join';

  return (
    <div className="min-h-screen" style={{ background: '#fff', color: DARK }}>
      {/* ── NAVIGATION ────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-40 border-b" style={{ background: 'rgba(255,255,255,0.94)', borderColor: 'rgba(0,0,0,0.08)' }}>
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center gap-3">
          {onBack && (
            <button type="button" aria-label="Back to the street" onClick={onBack} className="p-2 -ml-2 rounded-full hover:bg-black/5 cursor-pointer" style={{ color: DARK }}>
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div className="flex items-center gap-2">
            <WairoMark size={26} title="" />
            <span className="text-[17px] font-black tracking-tight">{campaign.title}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold" style={{ background: ROSE_TINT, color: ROSE }}>
              <Clock className="w-3.5 h-3.5" /> {range ?? 'Date TBC'}
            </span>
            <button type="button" onClick={() => { soundEngine.play('tap'); void share(); }} className="p-2 rounded-full hover:bg-black/5 cursor-pointer" aria-label="Share event" style={{ color: DARK }}>
              <Share2 className="w-5 h-5" />
            </button>
            <button type="button" onClick={scrollToTickets} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-black cursor-pointer" style={{ background: ROSE, color: '#fff' }}>
              <Ticket className="w-4 h-4" /> Tickets
            </button>
          </div>
        </div>
      </nav>

      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <header className="relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${ROSE} 0%, ${ORANGE} 100%)` }}>
        <div className="absolute inset-0 opacity-20" aria-hidden="true"
          style={{ backgroundImage: 'radial-gradient(circle at 20% 30%, #fff 2px, transparent 2px), radial-gradient(circle at 70% 60%, #fff 1.5px, transparent 1.5px)', backgroundSize: '48px 48px, 36px 36px' }} />
        <div className="relative max-w-3xl mx-auto px-4 py-16 sm:py-24 text-center">
          {(campaign.seriesId || hasFestivalContent) && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-black uppercase tracking-wider" style={{ background: 'rgba(255,255,255,0.22)', color: '#fff' }}>
              <Sparkles className="w-3.5 h-3.5" /> {campaign.seriesId ? 'Recurring series' : 'Community festival'}
            </span>
          )}
          {unlisted && (
            <span className="inline-flex items-center gap-1.5 ml-2 px-3 py-1 rounded-full text-[12px] font-black uppercase tracking-wider" style={{ background: 'rgba(0,0,0,0.35)', color: '#fff' }}>
              Invite-only · shared by link
            </span>
          )}
          <h1 className="text-[38px] sm:text-[56px] font-black leading-[1.02] mt-4 text-white">{campaign.title}</h1>
          <p className="text-[16px] sm:text-[19px] mt-4 max-w-xl mx-auto" style={{ color: 'rgba(255,255,255,0.9)' }}>
            {campaign.description || 'A Wairo event on the street.'}
          </p>
          <p className="inline-flex items-center gap-2 mt-5 px-4 py-2 rounded-full text-[14px] font-bold" style={{ background: 'rgba(0,0,0,0.22)', color: '#fff' }}>
            <Clock className="w-4 h-4" /> {range ?? 'Date to be confirmed'}
            {locationText && <><span aria-hidden="true">·</span> <MapPin className="w-4 h-4" /> {locationText}</>}
          </p>
          <div className="flex flex-wrap justify-center gap-3 mt-7">
            <button type="button" onClick={scrollToTickets} className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-[15px] font-black cursor-pointer" style={{ background: ROSE, color: '#fff', boxShadow: '0 12px 30px -12px rgba(0,0,0,0.5)' }}>
              <Ticket className="w-4 h-4" /> {campaign.price === 0 ? 'Reserve free' : 'Get tickets'}
            </button>
            {festival?.lineup && festival.lineup.length > 0 && (
              <button type="button" onClick={() => document.getElementById('ev-lineup')?.scrollIntoView({ behavior: 'smooth' })} className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-[15px] font-bold cursor-pointer" style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', border: '1.5px solid rgba(255,255,255,0.6)' }}>
                See the lineup
              </button>
            )}
          </div>
        </div>
        {/* wavy divider */}
        <svg className="block w-full h-8 sm:h-12" style={{ color: '#fff' }} viewBox="0 0 1440 64" preserveAspectRatio="none" aria-hidden="true">
          <path fill="currentColor" d="M0,32 C240,64 480,0 720,32 C960,64 1200,0 1440,32 L1440,64 L0,64 Z" />
        </svg>
      </header>

      <div className="max-w-6xl mx-auto px-4">
        {/* ── LINEUP ──────────────────────────────────────────────────── */}
        {festival?.lineup && festival.lineup.length > 0 && (
          <section id="ev-lineup" className="py-12" style={{ background: ROSE_TINT, margin: '0 -16px', padding: '48px 16px' }}>
            <h2 className="text-[26px] sm:text-[32px] font-black text-center" style={{ color: DARK }}>{festival.lineup.length} stalls. Zero bad bites.</h2>
            <p className="text-center text-[14px] mt-2" style={{ color: 'rgba(28,25,23,0.6)' }}>The vendors and stalls the organiser has named.</p>
            <div className="flex flex-wrap justify-center gap-2 mt-6">
              {lineupTags.map((tag) => (
                <button key={tag} type="button" onClick={() => { soundEngine.play('tap'); setLineupTag(tag); }}
                  className="px-3.5 py-1.5 rounded-full text-[13px] font-bold cursor-pointer transition-all"
                  style={lineupTag === tag ? { background: ROSE, color: '#fff' } : { background: '#fff', color: DARK, border: '1px solid rgba(0,0,0,0.12)' }}>
                  {tag}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mt-6">
              {lineup.map((l, i) => (
                <div key={i} className="rounded-xl overflow-hidden bg-white border hover:-translate-y-1 transition-all" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                  <div className="h-2 flex" aria-hidden="true" style={{ background: `linear-gradient(90deg, ${ROSE}, ${ORANGE})` }} />
                  <div className="p-4 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      {l.tag && <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide" style={{ background: YELLOW, color: DARK }}>{l.tag}</span>}
                      {l.zone && <span className="inline-flex items-center gap-1 text-[11px] font-bold" style={{ color: 'rgba(28,25,23,0.55)' }}><MapPin className="w-3 h-3" />{l.zone}</span>}
                    </div>
                    <p className="text-[15px] font-black leading-tight" style={{ color: DARK }}>{l.name}</p>
                    {l.description && <p className="text-[12px] leading-snug" style={{ color: 'rgba(28,25,23,0.6)' }}>{l.description}</p>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── MAP / ZONES ─────────────────────────────────────────────── */}
        {(festival?.zones && festival.zones.length > 0) && (
          <section className="py-12 bg-white">
            <h2 className="text-[26px] sm:text-[32px] font-black text-center" style={{ color: DARK }}>Find your way around</h2>
            <div className="grid md:grid-cols-2 gap-4 mt-8">
              {festival.zones.map((z, i) => (
                <button key={i} type="button"
                  onClick={() => { soundEngine.play('tap'); if (z.name) setLineupTag(z.name); document.getElementById('ev-lineup')?.scrollIntoView({ behavior: 'smooth' }); }}
                  className="flex items-center gap-3 p-4 rounded-xl border text-left cursor-pointer hover:-translate-y-0.5 transition-all"
                  style={{ borderColor: 'rgba(0,0,0,0.1)' }}>
                  <span className="w-4 h-4 rounded-full shrink-0" style={{ background: z.color ?? [ROSE, ORANGE, '#16A34A'][i % 3] }} />
                  <span className="min-w-0">
                    <span className="block text-[15px] font-black" style={{ color: DARK }}>{z.name}</span>
                    {z.description && <span className="block text-[12px] truncate" style={{ color: 'rgba(28,25,23,0.55)' }}>{z.description}</span>}
                  </span>
                </button>
              ))}
            </div>
            {maps && (
              <div className="text-center mt-6">
                <a href={maps} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[14px] font-bold cursor-pointer" style={{ background: ROSE, color: '#fff' }}>
                  <ExternalLink className="w-4 h-4" /> Open in Maps
                </a>
              </div>
            )}
          </section>
        )}

        {/* ── SCHEDULE ────────────────────────────────────────────────── */}
        {(schedules && schedules.length > 0) || campaign.agenda ? (
          <section className="py-12" style={{ background: ROSE_TINT, margin: '0 -16px', padding: '48px 16px' }}>
            <h2 className="text-[26px] sm:text-[32px] font-black text-center" style={{ color: DARK }}>Three days of flavor</h2>
            {schedules && schedules.length > 0 ? (
              <>
                <div className="flex justify-center gap-2 mt-6 flex-wrap">
                  {schedules.map((s, i) => (
                    <button key={i} type="button" onClick={() => { soundEngine.play('tap'); setScheduleDay(i); }}
                      className="px-4 py-2 rounded-full text-[13px] font-bold cursor-pointer transition-all"
                      style={i === scheduleDay ? { background: ROSE, color: '#fff' } : { background: '#fff', color: DARK, border: '1px solid rgba(0,0,0,0.12)' }}>
                      {s.label ?? s.day}
                    </button>
                  ))}
                </div>
                {currentSchedule && (
                  <div className="max-w-2xl mx-auto mt-6 rounded-2xl overflow-hidden border" style={{ borderColor: 'rgba(0,0,0,0.08)', background: '#fff' }}>
                    {currentSchedule.items.map((it, i) => (
                      <div key={i} className="flex gap-4 px-4 py-3.5 border-b last:border-b-0" style={i % 2 === 1 ? { background: '#FAFAFA' } : undefined}>
                        <span className="w-20 shrink-0 text-[13px] font-black font-mono" style={{ color: ROSE }}>{it.at ?? ''}</span>
                        <span className="min-w-0">
                          <span className="block text-[14px] font-bold" style={{ color: DARK }}>{it.title}</span>
                          {it.location && <span className="block text-[12px] font-bold mt-0.5" style={{ color: ORANGE }}>{it.location}</span>}
                          {it.description && <span className="block text-[12px] mt-0.5" style={{ color: 'rgba(28,25,23,0.6)' }}>{it.description}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="max-w-2xl mx-auto mt-6 rounded-2xl overflow-hidden border" style={{ borderColor: 'rgba(0,0,0,0.08)', background: '#fff' }}>
                {(campaign.agenda ?? []).map((it, i) => (
                  <div key={i} className="flex gap-4 px-4 py-3.5 border-b last:border-b-0" style={i % 2 === 1 ? { background: '#FAFAFA' } : undefined}>
                    <span className="w-20 shrink-0 text-[13px] font-black font-mono" style={{ color: ROSE }}>{it.at ?? ''}</span>
                    <span className="min-w-0">
                      <span className="block text-[14px] font-bold" style={{ color: DARK }}>{it.title}</span>
                      {it.description && <span className="block text-[12px] mt-0.5" style={{ color: 'rgba(28,25,23,0.6)' }}>{it.description}</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {/* ── TICKETS ─────────────────────────────────────────────────── */}
        <section id="ev-tickets" className="py-12 bg-white">
          <h2 className="text-[26px] sm:text-[32px] font-black text-center" style={{ color: DARK }}>
            {inclusions.length > 0 || campaign.capacity != null ? 'Join this experience' : 'Grab your ticket'}
          </h2>
          {inclusions.length > 0 && (
            <div className="max-w-md mx-auto mt-6">
              <p className="text-[13px] font-black uppercase tracking-wider text-center" style={{ color: 'rgba(28,25,23,0.5)' }}>What&apos;s included</p>
              <ul className="mt-3 grid grid-cols-2 gap-2">
                {inclusions.map((inc, i) => (
                  <li key={i} className="flex items-center gap-2 text-[14px] font-bold p-2.5 rounded-xl" style={{ background: ROSE_TINT, color: DARK }}>
                    <Check className="w-4 h-4 shrink-0" style={{ color: ROSE }} /> {inc}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {festival?.priceTiers && festival.priceTiers.length > 0 ? (
            <div className="grid md:grid-cols-3 gap-4 mt-8 max-w-4xl mx-auto">
              {festival.priceTiers.map((t, i) => <TicketCard key={i} tier={t} onBuy={() => setRegOpen(true)} />)}
            </div>
          ) : (
            <div className="max-w-md mx-auto mt-8 text-center rounded-2xl border p-6" style={{ borderColor: 'rgba(0,0,0,0.1)' }}>
              <p className="text-[14px] font-bold" style={{ color: 'rgba(28,25,23,0.6)' }}>{perPerson}</p>
              <p className="text-[34px] font-black mt-1" style={{ color: ROSE }}>{campaign.price === 0 ? 'Free' : money(campaign.price, campaign.currency)}</p>
              {teamLeft && <p className="text-[13px] mt-2" style={{ color: 'rgba(28,25,23,0.55)' }}>{teamLeft}</p>}
              {ticket ? (
                <TicketResult code={ticket.code} status={ticket.status} />
              ) : (
                <>
                  <button type="button" onClick={() => setRegOpen((o) => !o)} className="mt-5 w-full py-3 rounded-full text-[15px] font-black cursor-pointer" style={{ background: ROSE, color: '#fff' }}>
                    {regOpen ? 'Cancel' : campaign.price === 0 ? 'Reserve my spot' : 'Join for the price above'}
                  </button>
                  <button type="button" onClick={() => void share()} className="mt-2 w-full py-3 rounded-full text-[15px] font-bold cursor-pointer inline-flex items-center justify-center gap-1.5" style={{ background: 'transparent', color: DARK, border: '1.5px solid rgba(0,0,0,0.2)' }}>
                    <Share2 className="w-4 h-4" /> Share this {unlisted ? 'invite link' : 'event'}
                  </button>
                  {regOpen && (
                    <div className="mt-4 space-y-2 text-left">
                      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Your name" className="w-full px-4 py-2.5 rounded-xl border text-[14px]" style={{ borderColor: 'rgba(0,0,0,0.15)' }} />
                      <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Phone or email (optional)" aria-label="Contact" className="w-full px-4 py-2.5 rounded-xl border text-[14px]" style={{ borderColor: 'rgba(0,0,0,0.15)' }} />
                      {campaign.goalAmount != null && (
                        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Contribution (KES, optional)" inputMode="numeric" aria-label="Contribution" className="w-full px-4 py-2.5 rounded-xl border text-[14px]" style={{ borderColor: 'rgba(0,0,0,0.15)' }} />
                      )}
                      {regError && <p className="text-[13px] font-bold" style={{ color: ROSE }}>{regError}</p>}
                      <button type="button" disabled={busy} onClick={() => void submit()} className="w-full py-3 rounded-full text-[15px] font-black cursor-pointer disabled:opacity-50" style={{ background: DARK, color: '#fff' }}>
                        {busy ? 'Reserving…' : 'Confirm'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>

        {/* ── MUSIC ───────────────────────────────────────────────────── */}
        {festival?.artists && festival.artists.length > 0 && (
          <section className="py-12" style={{ background: DARK }}>
            <h2 className="text-[26px] sm:text-[32px] font-black text-center text-white">The soundtrack</h2>
            <div className="grid md:grid-cols-3 gap-4 mt-8 max-w-4xl mx-auto">
              {festival.artists.map((a, i) => (
                <div key={i} className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-black" style={{ background: ROSE, color: '#fff' }}>
                    <Sparkles className="w-3 h-3" /> {a.day ?? 'Live'}
                  </span>
                  <p className="text-[19px] font-black text-white mt-3">{a.name}</p>
                  {a.description && <p className="text-[13px] mt-2 leading-snug" style={{ color: 'rgba(255,255,255,0.7)' }}>{a.description}</p>}
                  {a.url && <a href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-bold mt-3" style={{ color: YELLOW }}><ExternalLink className="w-3 h-3" /> Listen</a>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── SPONSORS ────────────────────────────────────────────────── */}
        {festival?.sponsors && festival.sponsors.length > 0 && (
          <section className="py-12" style={{ background: YELLOW }}>
            <h2 className="text-[22px] sm:text-[26px] font-black text-center" style={{ color: DARK }}>Made possible by</h2>
            <div className="flex flex-wrap justify-center gap-3 mt-8 max-w-3xl mx-auto">
              {festival.sponsors.map((s, i) => (
                <div key={i} className="px-5 py-3 rounded-xl bg-white/70">
                  {s.tier && <p className="text-[10px] font-black uppercase tracking-wider" style={{ color: ROSE }}>{s.tier}</p>}
                  <p className="text-[16px] font-black" style={{ color: DARK }}>{s.name}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── FAQ ─────────────────────────────────────────────────────── */}
        {festival?.faqs && festival.faqs.length > 0 && (
          <section className="py-12 bg-white">
            <h2 className="text-[26px] sm:text-[32px] font-black text-center" style={{ color: DARK }}>Good questions</h2>
            <div className="max-w-2xl mx-auto mt-6">
              {festival.faqs.map((f, i) => (
                <Accordion key={i} q={f.q} a={f.a} open={faqOpen === i} onToggle={() => { soundEngine.play('tap'); setFaqOpen(faqOpen === i ? null : i); }} />
              ))}
            </div>
          </section>
        )}

        {/* ── FINAL CTA ───────────────────────────────────────────────── */}
        <section className="py-14 text-center" style={{ background: `linear-gradient(120deg, ${ROSE}, ${ORANGE})` }}>
          <h2 className="text-[28px] sm:text-[38px] font-black text-white">See you at the waterfront</h2>
          <p className="text-[15px] mt-2" style={{ color: 'rgba(255,255,255,0.9)' }}>Get your ticket and mark the date. Updates land in your Wairo notifications.</p>
          <div className="flex flex-wrap justify-center gap-3 mt-6">
            <button type="button" onClick={scrollToTickets} className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-[15px] font-black cursor-pointer" style={{ background: '#fff', color: ROSE }}>
              <Ticket className="w-4 h-4" /> {campaign.price === 0 ? 'Reserve free' : 'Get tickets'}
            </button>
            <button type="button" onClick={() => void share()} className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-[15px] font-bold cursor-pointer" style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', border: '1.5px solid rgba(255,255,255,0.6)' }}>
              <Share2 className="w-4 h-4" /> Share the event
            </button>
          </div>
        </section>

        {/* ── FOOTER ──────────────────────────────────────────────────── */}
        <footer className="py-10 px-4" style={{ background: '#fff', color: 'rgba(28,25,23,0.6)' }}>
          <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6 text-[13px]">
            <div>
              <div className="flex items-center gap-2 mb-2"><WairoMark size={22} title="" /><span className="text-[15px] font-black" style={{ color: DARK }}>Wairo</span></div>
              <p className="leading-snug">The digital street where business gets done.</p>
            </div>
            <div>
              <p className="font-black mb-2" style={{ color: DARK }}>Browse</p>
              <ul className="space-y-1.5">
                <li><button type="button" onClick={() => go('city/shops')} className="cursor-pointer hover:underline">Shops</button></li>
                <li><button type="button" onClick={() => go('city/events')} className="cursor-pointer hover:underline">Events</button></li>
                <li><button type="button" onClick={() => go('city/group')} className="cursor-pointer hover:underline">Group Buys</button></li>
              </ul>
            </div>
            <div>
              <p className="font-black mb-2" style={{ color: DARK }}>How it works</p>
              <ul className="space-y-1.5">
                <li><button type="button" onClick={() => go('you/how')} className="cursor-pointer hover:underline">How Wairo works</button></li>
                <li><button type="button" onClick={() => go('you/privacy')} className="cursor-pointer hover:underline">Privacy</button></li>
              </ul>
            </div>
            <div>
              <p className="font-black mb-2" style={{ color: DARK }}>The street</p>
              <p className="leading-snug">Brief records money between two sides — it moves none itself.</p>
            </div>
          </div>
          <div className="max-w-6xl mx-auto mt-8 pt-5 border-t text-[12px] flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
            <span>© {new Date().getFullYear()} Wairo Blue Avenue</span>
            <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> Kenya&apos;s informal economy</span>
          </div>
        </footer>
      </div>

      {/* ── MOBILE STICKY TICKETS ─────────────────────────────────────── */}
      <div className="sm:hidden fixed bottom-0 inset-x-0 z-40 p-3" style={{ background: 'rgba(255,255,255,0.94)', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
        <button type="button" onClick={scrollToTickets} className="w-full py-3 rounded-full text-[15px] font-black cursor-pointer" style={{ background: ROSE, color: '#fff' }}>
          {campaign.price === 0 ? 'Reserve free' : 'Get tickets'}
        </button>
      </div>
    </div>
  );
};

const TicketCard: React.FC<{ tier: FestivalPriceTier; onBuy: () => void }> = ({ tier, onBuy }) => (
  <div className="relative rounded-2xl border p-6 flex flex-col" style={{ borderColor: tier.badge ? ROSE : 'rgba(0,0,0,0.12)' }}>
    {tier.badge && (
      <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] font-black text-white" style={{ background: ROSE }}>{tier.badge}</span>
    )}
    <p className="text-[15px] font-black" style={{ color: DARK }}>{tier.name}</p>
    <p className="text-[32px] font-black mt-1" style={{ color: ROSE }}>{tier.price != null ? money(tier.price, tier.currency) : 'On site'}</p>
    {tier.perks && tier.perks.length > 0 && (
      <ul className="mt-4 space-y-2 flex-1">
        {tier.perks.map((p, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px]" style={{ color: 'rgba(28,25,23,0.72)' }}>
            <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: ROSE }} /> {p}
          </li>
        ))}
      </ul>
    )}
    <button type="button" onClick={onBuy} className="mt-5 w-full py-3 rounded-full text-[14px] font-black cursor-pointer" style={{ background: tier.badge ? ROSE : DARK, color: '#fff' }}>
      Buy
    </button>
  </div>
);

const TicketResult: React.FC<{ code: string | null; status: string }> = ({ code, status }) => (
  <div className="mt-4 rounded-xl p-4 text-center" style={{ background: ROSE_TINT }}>
    <p className="inline-flex items-center gap-1.5 text-[13px] font-black" style={{ color: ROSE }}>
      <Ticket className="w-4 h-4" /> You&apos;re in — {status}
    </p>
    {code && <p className="text-[22px] font-black font-mono mt-2 tracking-wider" style={{ color: DARK }}>{code}</p>}
    <p className="text-[11px] mt-1" style={{ color: 'rgba(28,25,23,0.55)' }}>Show this at the gate.</p>
  </div>
);

export default EventShowcase;
