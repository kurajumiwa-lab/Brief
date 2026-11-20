import { Link } from "react-router-dom";
import { ArrowRight, MessageCircle, Radio, Users } from "lucide-react";

/**
 * A static door on Home, not another feed. The live counts belong on /street;
 * this card gives the person one obvious place to look when they want company
 * instead of a catalogue.
 */
export default function StreetDoor() {
  return (
    <Link
      to="/street"
      data-testid="home-street-door"
      className="shelf-card group relative block overflow-hidden bg-[#171021] p-4 text-white"
    >
      <span className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-[#E8552F]/40 blur-3xl" aria-hidden="true" />
      <div className="relative">
        <div className="flex items-center justify-between gap-2">
          <p className="inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#FFD7A8]">
            <Radio size={12} aria-hidden="true" /> Live street
          </p>
          <ArrowRight size={15} className="text-white/60 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </div>
        <h2 className="mt-2 text-base font-extrabold leading-snug">Open a table. Join one nearby.</h2>
        <p className="mt-1 max-w-md text-[11px] leading-relaxed text-white/65">
          A co-buy, a rider, a source or a meet-up for the next two hours. The
          table closes itself; the handoff goes straight to WhatsApp or Telegram.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-1.5 text-[10px] font-bold text-white/75">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1"><Users size={10} aria-hidden="true" /> Co-buy</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1"><MessageCircle size={10} aria-hidden="true" /> Delivery</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1">No payment held</span>
        </div>
      </div>
    </Link>
  );
}
