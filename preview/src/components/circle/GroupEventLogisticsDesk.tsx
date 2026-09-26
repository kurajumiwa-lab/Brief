import React, { useState } from 'react';
import {
  CalendarDays,
  Users,
  Truck,
  Heart,
  ShieldCheck,
  CheckCircle2,
  Phone,
  ArrowRight,
  Clock,
  X,
  Plus
} from 'lucide-react';
import { DEMO_EVENT_LOGISTICS, GroupEventLogistics } from '../../model/neighborhoods';
import { soundEngine } from '../../utils/SoundEngine';

export interface GroupEventLogisticsDeskProps {
  onClose?: () => void;
  onContributeBudget?: (eventId: string, amountKes: number) => void;
}

export const GroupEventLogisticsDesk: React.FC<GroupEventLogisticsDeskProps> = ({
  onClose,
  onContributeBudget
}) => {
  const [events, setEvents] = useState<GroupEventLogistics[]>(DEMO_EVENT_LOGISTICS);
  const [selectedEventId, setSelectedEventId] = useState<string>(events[0]?.id || '');
  const [contributionInput, setContributionInput] = useState<string>('2000');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const activeEvent = events.find((e) => e.id === selectedEventId) || events[0];

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleContribute = () => {
    const amount = parseInt(contributionInput, 10);
    if (isNaN(amount) || amount <= 0) return;

    soundEngine.play('victory');
    setEvents((prev) =>
      prev.map((e) =>
        e.id === activeEvent.id
          ? {
              ...e,
              pledgedBudgetKes: e.pledgedBudgetKes + amount
            }
          : e
      )
    );
    showToast(`Contributed KES ${amount.toLocaleString()} to "${activeEvent.eventName}" budget!`);
    onContributeBudget?.(activeEvent.id, amount);
  };

  const callSupplier = (phone: string, supplierName: string) => {
    soundEngine.play('heavyTap');
    showToast(`Calling verified operator: ${supplierName}`);
    window.location.href = `tel:${phone.replace(/\s+/g, '')}`;
  };

  const percentFunded = Math.round(
    (activeEvent.pledgedBudgetKes / activeEvent.targetBudgetKes) * 100
  );

  return (
    <div className="w-full max-w-3xl mx-auto rounded-3xl bg-[color:var(--color-paper)] shadow-2xl overflow-hidden font-sans text-[var(--brief-ink)]">
      
      {/* ── HEADER ── */}
      <div className="p-6 sm:p-7 bg-gradient-to-br from-[#1E1B4B] via-[#312E81] to-[#1E1B4B] text-white relative">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center space-x-2">
              <span className="text-[11px] font-mono font-black uppercase px-2.5 py-0.5 rounded-full bg-[#E8985E] text-[#1E1B4B] tracking-wider">
                COMMUNITY EVENT OPERATIONS
              </span>
              <span className="text-xs text-emerald-200 font-bold flex items-center space-x-1">
                <CalendarDays className="w-3.5 h-3.5 text-amber-300" />
                <span>Choir, Retreat & Sports Ops</span>
              </span>
            </div>

            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center space-x-2">
              <span>Group Event & Touring Logistics Desk</span>
            </h2>
            <p className="text-xs text-emerald-200/90 max-w-lg leading-relaxed">
              Operational coordination for church choirs, sports clubs, and alumni associations. Rosters, transparent budget desks, and WAIRO gear transport.
            </p>
          </div>

          {onClose && (
            <button
              type="button"
              onClick={() => {
                soundEngine.play('tap');
                onClose();
              }}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── EVENT DETAILS ── */}
      <div className="p-6 sm:p-7 space-y-6">
        
        {/* Main Event Overview Card */}
        <div className="p-5 rounded-2xl bg-white shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="text-[11px] font-mono font-black uppercase text-emerald-600 tracking-wide">
                {activeEvent.groupName}
              </span>
              <h3 className="text-lg font-black text-[var(--brief-ink)] leading-snug">
                {activeEvent.eventName}
              </h3>
            </div>

            <div className="flex items-center space-x-2">
              <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-black">
                {activeEvent.eventDate}
              </span>
            </div>
          </div>

          {/* 4-Quadrant Operational Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            
            {/* 1. Member Roster */}
            <div className="p-4 rounded-xl bg-[#F0EDE8] space-y-1">
              <div className="flex items-center space-x-2">
                <Users className="w-4 h-4 text-[#B8621F]" />
                <span className="text-xs font-black uppercase text-[var(--brief-ink)]">Member Roster</span>
              </div>
              <p className="text-sm font-extrabold text-[var(--brief-ink)]">
                {activeEvent.rosterCount} Confirmed Attendees
              </p>
              <p className="text-[12px] text-[var(--brief-muted)]">
                All roles assigned (Singers, Logistics, Welfare)
              </p>
            </div>

            {/* 2. Budget Progress */}
            <div className="p-4 rounded-xl bg-[#F0EDE8] space-y-1">
              <div className="flex items-center space-x-2">
                <Heart className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-black uppercase text-[var(--brief-ink)]">Budget Pool</span>
              </div>
              <p className="text-sm font-extrabold text-[var(--brief-ink)]">
                KES {activeEvent.pledgedBudgetKes.toLocaleString()} / {activeEvent.targetBudgetKes.toLocaleString()}
              </p>
              <p className="text-[12px] text-emerald-700 font-bold">
                {percentFunded}% funded via direct M-Pesa gifts
              </p>
            </div>

            {/* 3. WAIRO Gear Logistics */}
            <div className="p-4 rounded-xl bg-[#F0EDE8] space-y-1">
              <div className="flex items-center space-x-2">
                <Truck className="w-4 h-4 text-[#00BFEF]" />
                <span className="text-xs font-black uppercase text-[var(--brief-ink)]">Gear Transport</span>
              </div>
              <p className="text-sm font-extrabold text-[var(--brief-ink)]">
                WAIRO Cargo Van Assigned
              </p>
              <p className="text-[12px] text-[var(--brief-muted)]">
                Sound gear, robes & kitchen items tracked
              </p>
            </div>

            {/* 4. Verified Operators */}
            <div className="p-4 rounded-xl bg-[#F0EDE8] space-y-1">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-purple-600" />
                <span className="text-xs font-black uppercase text-[var(--brief-ink)]">Local Charters</span>
              </div>
              <p className="text-sm font-extrabold text-[var(--brief-ink)]">
                3 Vetted Operators
              </p>
              <p className="text-[12px] text-[var(--brief-muted)]">
                Vouched by Stage Champions
              </p>
            </div>
          </div>

          {/* Itinerary */}
          <div className="pt-2 space-y-2">
            <span className="text-xs font-black uppercase tracking-wider text-[var(--brief-ink)] block">
              Coordinated Itinerary & Milestones
            </span>
            <div className="space-y-1.5">
              {activeEvent.itinerary.map((step, idx) => (
                <div key={idx} className="flex items-start space-x-2 text-xs text-[var(--brief-muted)]">
                  <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Verified Suppliers Directory */}
        <div className="space-y-3">
          <span className="text-xs font-black uppercase tracking-wider text-[var(--brief-ink)] block">
            Vetted Local Operators & Suppliers
          </span>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {activeEvent.suppliers.map((sup, idx) => (
              <div key={idx} className="p-4 rounded-2xl bg-white shadow-sm space-y-2 flex flex-col justify-between">
                <div>
                  <span className="text-[11px] font-mono font-bold uppercase text-[#B8621F] block">
                    {sup.category}
                  </span>
                  <h4 className="text-xs font-black text-[var(--brief-ink)] leading-snug">{sup.name}</h4>
                  <p className="text-[11px] text-[var(--brief-muted)] mt-0.5">Vouched by {sup.vouchedBy}</p>
                </div>

                <button
                  type="button"
                  onClick={() => callSupplier(sup.phone, sup.name)}
                  className="w-full py-2 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-xs font-bold text-[var(--brief-ink)] flex items-center justify-center space-x-1.5 transition-colors cursor-pointer"
                >
                  <Phone className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Call Operator</span>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Budget Contribution Box */}
        <div className="p-5 rounded-2xl bg-[#EFECE6] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <span className="text-xs font-black text-[var(--brief-ink)]">Contribute to Pool:</span>
            <div className="flex items-center space-x-1.5">
              <span className="text-xs font-bold text-[var(--brief-muted)]">KES</span>
              <input
                type="number"
                value={contributionInput}
                onChange={(e) => setContributionInput(e.target.value)}
                className="w-24 px-3 py-2 rounded-xl bg-white text-xs font-bold shadow-sm outline-none"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={handleContribute}
            className="py-3 px-6 rounded-xl bg-[#1E1B4B] hover:bg-[#312E81] text-white font-black text-xs uppercase tracking-wider shadow-md transition-transform active:scale-95 cursor-pointer flex items-center justify-center space-x-2"
          >
            <span>Send Harambee Gift</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* Non-Promise Disclaimer */}
        <div className="p-3.5 rounded-2xl bg-black/[0.03] space-y-1 text-center">
          <p className="text-[11px] text-[var(--brief-muted)] leading-relaxed">
            Brief coordinates event operations for existing groups. Contributions move directly between members and suppliers via M-Pesa. Brief is not a travel agency or event guarantor.
          </p>
        </div>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl bg-[color:var(--brief-ink)] text-white text-xs font-bold shadow-2xl flex items-center space-x-2 animate-fadeIn border border-white/10">
          <CheckCircle2 className="w-4 h-4 text-[#2ECC71]" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
