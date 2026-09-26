import React from 'react';
import { ShieldCheck, CheckCircle2, Truck, BookOpen, Smartphone, Landmark, Award } from 'lucide-react';
import { soundEngine } from '../../utils/SoundEngine';

export interface PartnerPill {
  id: string;
  name: string;
  sub?: string;
  icon?: React.ReactNode;
}

export interface TrustedPartnerRibbonProps {
  title?: string;
  partners?: PartnerPill[];
  onPartnerClick?: (partner: PartnerPill) => void;
  className?: string;
}

const DEFAULT_PARTNERS: PartnerPill[] = [
  { id: 'kicd', name: 'KICD Approved', sub: 'CBC Textbooks', icon: <BookOpen className="w-3.5 h-3.5 text-emerald-600" /> },
  { id: 'fargo', name: 'Fargo Courier', sub: '200+ Counters', icon: <Truck className="w-3.5 h-3.5 text-blue-600" /> },
  { id: 'lori', name: 'Lori Systems', sub: '50% Backhaul', icon: <Truck className="w-3.5 h-3.5 text-amber-600" /> },
  { id: 'mpesa', name: 'Safaricom M-Pesa', sub: 'STK Rails', icon: <Smartphone className="w-3.5 h-3.5 text-emerald-600" /> },
  { id: 'pezesha', name: 'Pezesha Credit', sub: 'White-Label', icon: <Landmark className="w-3.5 h-3.5 text-purple-600" /> },
  { id: 'sendy', name: 'Sendy Freight', sub: 'Direct Cargo', icon: <Award className="w-3.5 h-3.5 text-emerald-600" /> }
];

export const TrustedPartnerRibbon: React.FC<TrustedPartnerRibbonProps> = ({
  title = 'Trusted by 10,000+ communities & 47 County logistics desks',
  partners = DEFAULT_PARTNERS,
  onPartnerClick,
  className = ''
}) => {
  return (
    <section className={`w-full space-y-3 py-2 ${className}`}>
      <div className="flex items-center justify-between px-1">
        <span className="text-[12px] sm:text-xs font-bold text-[var(--brief-muted)] tracking-wide">
          {title}
        </span>
        <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-[#93EE34]/20 text-[#0C221F]">
          VERIFIED RAILS
        </span>
      </div>

      <div className="flex items-center space-x-2.5 overflow-x-auto no-scrollbar py-1">
        {partners.map((partner) => (
          <button
            key={partner.id}
            type="button"
            onClick={() => {
              soundEngine.play('tap');
              onPartnerClick?.(partner);
            }}
            className="shrink-0 px-3.5 py-2 rounded-full bg-[#F4F7F2] hover:bg-[#EBF0E8] active:scale-95 transition-all text-[var(--brief-ink)] flex items-center space-x-2 shadow-xs cursor-pointer group"
          >
            <div className="w-5 h-5 rounded-full bg-[color:var(--color-paper)] flex items-center justify-center shadow-2xs group-hover:scale-110 transition-transform">
              {partner.icon || <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
            </div>
            <div className="flex flex-col text-left">
              <span className="text-xs font-extrabold text-[#0C221F] leading-tight">
                {partner.name}
              </span>
              {partner.sub && (
                <span className="text-[11px] text-[var(--brief-muted)] font-medium leading-none">
                  {partner.sub}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
};

export default TrustedPartnerRibbon;
