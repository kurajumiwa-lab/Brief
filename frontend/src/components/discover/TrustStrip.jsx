import { BadgeCheck, Banknote, ShieldCheck, Truck } from "lucide-react";

/**
 * Four promises the network can actually keep. They are facts about how the
 * marketplace works, not badges bought by a seller.
 */
const PROMISES = [
  { Icon: Truck, title: "Nearby first", note: "Distance on every card" },
  { Icon: ShieldCheck, title: "Trade on record", note: "A level you can read" },
  { Icon: Banknote, title: "Seller-set prices", note: "Quote or stated price" },
  { Icon: BadgeCheck, title: "No paid placement", note: "Ranking is earned" },
];

export default function TrustStrip() {
  return (
    <section aria-label="How this marketplace works" className="grid grid-cols-2 overflow-hidden rounded-2xl border border-mk-line bg-mk-card">
      {PROMISES.map(({ Icon, title, note }, index) => (
        <div
          key={title}
          className={[
            "flex flex-col items-center gap-1 px-3 py-4 text-center",
            index % 2 === 1 ? "border-l border-mk-line" : "",
            index > 1 ? "border-t border-mk-line" : "",
          ].join(" ")}
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-mk-orange-soft text-mk-orange">
            <Icon size={16} aria-hidden="true" />
          </span>
          <span className="text-[13px] font-extrabold text-mk-ink">{title}</span>
          <span className="text-[11px] leading-tight text-mk-ink-soft">{note}</span>
        </div>
      ))}
    </section>
  );
}
