import { BadgeCheck, Banknote, ShieldCheck, Truck } from "lucide-react";
import Modal from "@/components/ui/Modal";

/**
 * HOW WASTA WORKS — the four promises, kept off the critical path.
 *
 * They used to sit in a 2×2 grid above the first result, where they pushed the
 * top picks below the fold. The facts still matter, so they live one tap away
 * behind the ranking note instead of occupying a third of a phone screen.
 */
const PROMISES = [
  { Icon: Truck, title: "Nearby first", note: "Distance is printed on every card, not inferred from a market name." },
  { Icon: ShieldCheck, title: "Trade on record", note: "The level shows completed trades and confirmed proofs, never a bought badge." },
  { Icon: Banknote, title: "Seller-set prices", note: "A price is the seller's quote or stated amount. Wasta does not invent a discount." },
  { Icon: BadgeCheck, title: "No paid placement", note: "Ranking uses proximity, timing, recency and real activity. No slot is for sale." },
];

export default function HowWastaWorks({ open, onClose }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="How Wasta works"
      description="The promises behind every result — no badges to buy, no ratings we cannot prove."
      className="border-mk-line bg-mk-cream"
    >
      <ul data-testid="discover-how-it-works" className="space-y-2.5">
        {PROMISES.map(({ Icon, title, note }) => (
          <li key={title} className="soft-card flex gap-3 rounded-xl bg-mk-card p-3">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-mk-orange-soft text-mk-orange">
              <Icon size={15} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-extrabold text-mk-ink">{title}</span>
              <span className="mt-0.5 block text-2xs leading-relaxed text-mk-ink-soft">{note}</span>
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
