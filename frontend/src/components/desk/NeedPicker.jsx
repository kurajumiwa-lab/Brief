import {
  Building2, MessagesSquare, Palette, Smartphone, SmartphoneNfc,
} from "lucide-react";
import { tintForDesk } from "@/config/categoryTints";
import { cn } from "@/lib/utils";

/**
 * THE NEED PICKER — the front door of the business desk.
 *
 * Five needs, one line each, no prices and no paragraphs. A buyer arrives
 * knowing their problem ("we need a website", "our officers need to file
 * reports"), not our product structure, so this screen is written in their
 * words and nothing else.
 *
 * The icons and hues are fixed per desk so the same need is recognisable on
 * the picker, on the service list and on the request form. No new palette: the
 * desks borrow the marketplace categories' hues, because a colour that changes
 * meaning between screens is decoration.
 */
export const DESK_ICONS = {
  digital_services: Palette,
  business_software: Building2,
  field_operations: Smartphone,
  device_management: SmartphoneNfc,
  custom: MessagesSquare,
};

export function deskIcon(key) {
  return DESK_ICONS[key] || Building2;
}

/** One row of the picker. Shared by the modal and the page underneath it. */
export function NeedRow({ desk, onSelect, active = false, className }) {
  const Icon = deskIcon(desk.key);
  const tint = tintForDesk(desk.key);
  return (
    <button
      type="button"
      onClick={() => onSelect(desk.key)}
      aria-pressed={active}
      data-testid={`desk-${desk.key}`}
      className={cn(
        "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50",
        active ? "bg-surface-2" : "hover:bg-surface-2",
        className,
      )}
    >
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
          tint.wash,
          tint.ink,
        )}
        aria-hidden="true"
      >
        <Icon size={18} strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-tight text-ink-1">
          {desk.title}
        </span>
        <span className="mt-0.5 block truncate text-2xs text-ink-3">{desk.blurb}</span>
      </span>
      <span className="shrink-0 text-micro font-semibold tabular-nums text-ink-4">
        {desk.enquiry_only ? "Talk to us" : desk.offer_count}
      </span>
    </button>
  );
}

/** The five needs as one list — used inside the modal and on the desk page. */
export default function NeedPicker({ desks = [], onSelect, activeKey, className }) {
  return (
    <div
      role="group"
      aria-label="What does your business need?"
      data-testid="need-picker"
      className={cn("divide-y divide-edge-1", className)}
    >
      {desks.map((desk) => (
        <NeedRow
          key={desk.key}
          desk={desk}
          active={activeKey === desk.key}
          onSelect={onSelect}
          className="rounded-none px-0"
        />
      ))}
    </div>
  );
}
