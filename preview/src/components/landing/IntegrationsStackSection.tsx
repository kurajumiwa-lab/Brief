import React from 'react';
import { 
  Smartphone, 
  Truck, 
  BookOpen, 
  Landmark, 
  MessageSquare, 
  Layers, 
  CheckCircle2, 
  ArrowRight,
  ShieldCheck
} from 'lucide-react';
import { soundEngine } from '../../utils/SoundEngine';

export interface IntegrationBadge {
  id: string;
  name: string;
  icon?: React.ReactNode;
  position: string; // Tailwind absolute position class
}

const INTEGRATION_BADGES: IntegrationBadge[] = [
  { id: 'mpesa', name: 'M-Pesa STK', icon: <Smartphone className="w-3.5 h-3.5 text-emerald-600" />, position: 'top-10 left-4 sm:left-12' },
  { id: 'pezesha', name: 'Pezesha Credit', icon: <Landmark className="w-3.5 h-3.5 text-purple-600" />, position: 'top-6 left-1/3 sm:left-1/4' },
  { id: 'fargo', name: 'Fargo 200+', icon: <Truck className="w-3.5 h-3.5 text-blue-600" />, position: 'top-6 right-1/3 sm:right-1/4' },
  { id: 'lori', name: 'Lori Systems', icon: <Truck className="w-3.5 h-3.5 text-amber-600" />, position: 'top-12 right-4 sm:right-12' },
  { id: 'kicd', name: 'KICD Approved', icon: <BookOpen className="w-3.5 h-3.5 text-emerald-600" />, position: 'top-28 left-2 sm:left-8' },
  { id: 'whatsapp', name: 'WhatsApp Bot', icon: <MessageSquare className="w-3.5 h-3.5 text-green-600" />, position: 'top-32 right-2 sm:right-8' },
  { id: 'sendy', name: 'Sendy Freight', icon: <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />, position: 'top-48 left-6 sm:left-16' },
  { id: 'sacco', name: 'Matatu SACCOs', icon: <Layers className="w-3.5 h-3.5 text-rose-600" />, position: 'top-48 right-6 sm:right-16' }
];

export interface IntegrationsStackSectionProps {
  onOpenIntegrations?: () => void;
  className?: string;
}

export const IntegrationsStackSection: React.FC<IntegrationsStackSectionProps> = ({
  onOpenIntegrations,
  className = ''
}) => {
  return (
    <section
      className={`relative w-full rounded-[32px] overflow-hidden p-6 sm:p-12 text-white shadow-xl ${className}`}
      style={{
        background: 'linear-gradient(180deg, #16362C 0%, #0C221F 60%, #071614 100%)'
      }}
    >
      {/* ── 3D EXTUDED NEON TITLE ── */}
      <div className="text-center pt-2 pb-6 relative z-20">
        <h2 
          className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-none uppercase"
          style={{
            color: '#93EE34',
            textShadow: '0 2px 0 #6EB921, 0 4px 0 #4C8215, 0 6px 0 #2E520B, 0 8px 12px rgba(0,0,0,0.6)'
          }}
        >
          Slots straight into your
          <span className="block mt-1">existing stack</span>
        </h2>
      </div>

      {/* ── CENTRAL FOCAL ARTWORK WITH FLOATING INTEGRATION CLOUDS ── */}
      <div className="relative w-full max-w-lg mx-auto aspect-[4/3] sm:aspect-[16/10] my-2 flex items-center justify-center">
        {/* Ambient Halo behind hero */}
        <div className="absolute inset-0 max-w-md mx-auto rounded-full bg-[#93EE34]/15 blur-3xl pointer-events-none" />

        {/* Central Visual Portrait / Graphic */}
        <div className="relative z-10 w-48 h-48 sm:w-64 sm:h-64 rounded-full overflow-hidden border-4 border-[#93EE34]/30 shadow-2xl bg-[color:var(--brief-ink)]">
          <img
            src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=800&auto=format&fit=crop"
            alt="Community Leader"
            className="w-full h-full object-cover object-top"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0C221F]/70 via-transparent to-transparent" />
        </div>

        {/* Floating Tool Bubbles */}
        {INTEGRATION_BADGES.map((item) => (
          <div
            key={item.id}
            className={`absolute ${item.position} z-20 px-3 py-1.5 rounded-full bg-white/95 backdrop-blur-md text-[var(--brief-ink)] shadow-xl flex items-center space-x-1.5 transition-transform duration-300 hover:scale-110`}
          >
            {item.icon}
            <span className="text-[12px] font-black tracking-tight">{item.name}</span>
          </div>
        ))}
      </div>

      {/* ── BOTTOM INFO & NEON PILL CTA ── */}
      <div className="relative z-20 pt-8 sm:pt-10 flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 border-t border-white/10">
        <div className="max-w-md space-y-1">
          <p className="text-xs sm:text-sm font-semibold text-gray-300 leading-relaxed">
            Already got your tools running? Brief integrates directly with M-Pesa, Pezesha credit scoring, and Lori backhauls so you can coordinate without changing how you work.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            soundEngine.play('heavyTap');
            onOpenIntegrations?.();
          }}
          className="shrink-0 px-6 py-3 rounded-full bg-[#93EE34] hover:bg-[#82D62C] active:scale-95 text-[#0C221F] font-black text-xs sm:text-sm shadow-lg flex items-center space-x-2 transition-transform cursor-pointer"
        >
          <span>See all integrations</span>
          <ArrowRight className="w-4 h-4 text-[#0C221F]" />
        </button>
      </div>
    </section>
  );
};

export default IntegrationsStackSection;
