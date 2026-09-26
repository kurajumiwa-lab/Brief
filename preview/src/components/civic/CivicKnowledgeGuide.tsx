import React, { useState } from 'react';
import { 
  Building2, 
  CheckCircle2, 
  Clock, 
  FileText, 
  ExternalLink, 
  Search, 
  Bookmark, 
  Share2, 
  Phone, 
  CalendarDays, 
  ShoppingBag, 
  Flag, 
  ShieldCheck, 
  Plus, 
  X,
  Check,
  ArrowRight,
  Sparkles
} from 'lucide-react';
import { soundEngine } from '../../utils/SoundEngine';

export function CivicKnowledgeGuide({
  onClose,
  onAction
}: {
  onClose?: () => void;
  onAction?: (actionName: string) => void;
}) {
  const [saved, setSaved] = useState(false);
  const [followed, setFollowed] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const triggerAction = (name: string) => {
    soundEngine.play('tap');
    if (name === 'Save') setSaved(prev => !prev);
    if (name === 'Follow') setFollowed(prev => !prev);

    setActionNotice(`${name} triggered`);
    setTimeout(() => setActionNotice(null), 2500);

    if (onAction) onAction(name);
  };

  const protocolActions = [
    { id: 'discover', label: 'Discover', icon: Search, color: '#00BFEF' },
    { id: 'read', label: 'Read', icon: FileText, color: '#10B981' },
    { id: 'save', label: saved ? 'Saved' : 'Save', icon: Bookmark, color: '#F59E0B' },
    { id: 'share', label: 'Share', icon: Share2, color: '#8B5CF6' },
    { id: 'contact', label: 'Contact', icon: Phone, color: '#3B82F6' },
    { id: 'book', label: 'Book', icon: CalendarDays, color: '#EC4899' },
    { id: 'buy', label: 'Buy', icon: ShoppingBag, color: '#40916C' },
    { id: 'report', label: 'Report', icon: Flag, color: '#EF4444' },
    { id: 'verify', label: 'Verify', icon: ShieldCheck, color: '#10B981' },
    { id: 'follow', label: followed ? 'Following' : 'Follow', icon: Plus, color: '#40916C' }
  ];

  return (
    <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-3xl overflow-hidden shadow-2xl text-[var(--brief-ink)] max-w-2xl mx-auto">
      
      {/* ================= HEADER ================= */}
      <div className="bg-[color:var(--brief-ink)] text-white p-5 sm:p-6 relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500 text-white flex items-center space-x-1">
                <CheckCircle2 className="w-3 h-3" />
                <span>VERIFIED CIVIC GUIDE</span>
              </span>
              <span className="text-xs text-gray-400">15 days ago • Business & Legal</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black mt-2 text-white">
              How to renew your business permit?
            </h2>
            <p className="text-xs text-[#DCE2E6]/80 mt-0.5">
              Official guide for Single Business Permit (SBP) renewal in Kisii & Nairobi
            </p>
          </div>

          {onClose && (
            <button
              onClick={() => { soundEngine.play('tap'); onClose(); }}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="p-5 sm:p-6 space-y-5">
        
        {/* ================= STEP-BY-STEP PROCESS ================= */}
        <section className="space-y-3">
          <h3 className="text-xs font-black uppercase tracking-wider text-[var(--brief-ink)]">
            Step-by-Step Renewal Process
          </h3>

          <div className="space-y-2 text-xs">
            {[
              { num: '1', title: 'Visit City Permit Portal or Huduma Centre Counter 8', desc: 'Online application is open 24/7. In-person counters accept walk-ins from 8:00 AM.' },
              { num: '2', title: 'Submit Required Verification Documents', desc: 'Upload previous permit copy and tax compliance certificate.' },
              { num: '3', title: 'Pay the Official County Renewal Fee via M-Pesa', desc: 'County Paybill invoice generated instantly. No cash accepted at county offices.' },
              { num: '4', title: 'Download & Print Your Verified SBP Certificate', desc: 'QR-coded certificate valid immediately across all county inspection checkpoints.' }
            ].map(step => (
              <div key={step.num} className="p-3 bg-[color:var(--brief-bg)] border border-[var(--brief-line)] rounded-2xl flex items-start space-x-3">
                <span className="w-6 h-6 rounded-full bg-[color:var(--brief-ink)] text-white flex items-center justify-center font-bold text-xs shrink-0">
                  {step.num}
                </span>
                <div>
                  <h4 className="font-bold text-[var(--brief-ink)]">{step.title}</h4>
                  <p className="text-[12px] text-gray-500 mt-0.5">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ================= REQUIRED DOCUMENTS ================= */}
        <section className="p-4 bg-gray-50 border border-gray-200 rounded-2xl space-y-2">
          <h3 className="text-xs font-black uppercase tracking-wider text-[var(--brief-ink)]">
            Required Documents Checklist
          </h3>
          <ul className="space-y-1.5 text-xs text-gray-700">
            <li className="flex items-center space-x-2">
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>Valid National ID / Alien Card of Business Owner</span>
            </li>
            <li className="flex items-center space-x-2">
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>Previous Single Business Permit (SBP) Account Number</span>
            </li>
            <li className="flex items-center space-x-2">
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>Business Registration Proof (BRS Certificate / BN Number)</span>
            </li>
            <li className="flex items-center space-x-2">
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>Physical plot address / Sub-county location zone</span>
            </li>
          </ul>
        </section>

        {/* ================= SOURCE LINK ================= */}
        <div className="flex items-center justify-between text-xs text-gray-500 border-t border-gray-100 pt-3">
          <span>Source: <b>Brief Town Government & Revenue Portal</b></span>
          <a
            href="https://brief.ke"
            target="_blank"
            rel="noreferrer"
            className="text-[#40916C] font-bold flex items-center space-x-1 hover:underline"
          >
            <span>Official County Portal</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        {/* ================= THE UNIVERSAL PROTOCOL BAR ================= */}
        <section className="pt-2 border-t border-gray-200 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-gray-500">
              THE PROTOCOL BAR (10 ACTIONS)
            </span>
            {actionNotice && (
              <span className="text-[11px] font-bold text-emerald-600 animate-fadeIn">
                ✓ {actionNotice}
              </span>
            )}
          </div>

          <div className="grid grid-cols-5 sm:grid-cols-10 gap-1.5">
            {protocolActions.map(act => {
              const IconComp = act.icon;
              return (
                <button
                  key={act.id}
                  type="button"
                  onClick={() => triggerAction(act.label)}
                  className="p-2 rounded-xl bg-[color:var(--brief-bg)] border border-[var(--brief-line)] hover:bg-gray-100 flex flex-col items-center justify-center space-y-1 transition-all cursor-pointer"
                >
                  <IconComp className="w-4 h-4" style={{ color: act.color }} />
                  <span className="text-[11px] font-bold text-gray-700 block">{act.label}</span>
                </button>
              );
            })}
          </div>
        </section>

      </div>

    </div>
  );
}
