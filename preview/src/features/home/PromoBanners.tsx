import React from 'react';
import { Truck, Users, ArrowRight } from 'lucide-react';
import { soundEngine } from '../../utils/SoundEngine';

// ---------------------------------------------------------------------------
// PROMO BANNERS — the "Explore" rail: Amazon-style portrait cards, in Wairo's
// palette. Each card is a banner the street is promoting to its own people,
// labelled PROMOTED / SPONSORED, and it goes to the real destination it
// advertises. No stock photography (none is uploaded) — a bold brand gradient
// plus an icon does the art, the same honest rule as the festival page.
//
// Add a banner to the array to add a card; the rail scrolls and peeks the
// next card, like the reference.
// ---------------------------------------------------------------------------

interface Banner {
  id: string;
  tag: 'PROMOTED' | 'SPONSORED';
  title: string;
  sub: string;
  cta: string;
  hash: string;
  gradient: string;
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}

const BANNERS: Banner[] = [
  {
    id: 'trips',
    tag: 'PROMOTED',
    title: 'Overland Rail & Coastal Trade Getaway',
    sub: 'Mombasa → Nairobi → Kisumu corridor · 3-day slow transit with partner stays',
    cta: 'Explore Trips',
    hash: 'city/events',
    gradient: 'linear-gradient(155deg, #0E1B2A 0%, #14532D 55%, #2F8F68 100%)',
    Icon: Truck,
  },
  {
    id: 'groupbuy',
    tag: 'SPONSORED',
    title: 'Wholesale Grain & Sugar Pool',
    sub: 'Pool demand with 12 neighborhood shops for direct farmgate pricing',
    cta: 'Join Group Buy',
    hash: 'city/group',
    gradient: 'linear-gradient(155deg, #7A1E2B 0%, #C2410C 52%, #F97316 100%)',
    Icon: Users,
  },
];

export const PromoBanners: React.FC<{ className?: string }> = ({ className = '' }) => (
  <section aria-label="Explore" className={`no-scrollbar -mx-4 px-4 ${className}`}>
    <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-1">
      {BANNERS.map((b) => {
        const Icon = b.Icon;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => { soundEngine.play('tap'); window.location.hash = b.hash; }}
            className="shrink-0 snap-start rounded-2xl overflow-hidden relative text-left cursor-pointer transition-transform active:scale-[0.99]"
            style={{ width: 236, aspectRatio: '3 / 4', background: b.gradient }}
          >
            {/* watermark icon — brand art, not a photo */}
            <Icon
              className="absolute -bottom-5 -right-5 w-36 h-36"
              style={{ color: 'rgba(255,255,255,0.14)' }}
            />
            {/* subtle top light */}
            <span
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'radial-gradient(120% 60% at 85% 0%, rgba(255,255,255,0.22), transparent 60%)' }}
            />
            <div className="relative h-full flex flex-col justify-between p-5">
              <div>
                <span
                  className="inline-block px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest"
                  style={{ background: 'rgba(255,255,255,0.92)', color: '#1C1917' }}
                >
                  {b.tag}
                </span>
                <h3 className="text-[23px] font-black leading-[1.05] text-white mt-3 line-clamp-3">
                  {b.title}
                </h3>
              </div>
              <div>
                <p className="text-[13px] leading-snug" style={{ color: 'rgba(255,255,255,0.82)' }}>
                  {b.sub}
                </p>
                <span className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-black" style={{ background: '#fff', color: '#1C1917' }}>
                  {b.cta} <ArrowRight className="w-4 h-4" />
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  </section>
);

export default PromoBanners;
