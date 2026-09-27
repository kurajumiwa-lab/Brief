import React, { useState } from 'react';
import { WairoElevateMarket } from './ElevateMarket';
import { WairoElevateLedger } from './ElevateLedger';
import { WairoElevateOnboard } from './ElevateOnboard';

// ElevateHub — one Wairo surface that surfaces the three standalone Elevate
// pages as features, without moving them.

type ElevateTab = 'market' | 'ledger' | 'onboard';

export const ElevateHub: React.FC<{ initial?: ElevateTab }> = ({ initial = 'market' }) => {
  const [tab, setTab] = useState<ElevateTab>(initial);

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {[
          ['market', 'Market'],
          ['ledger', 'Ledger'],
          ['onboard', 'Onboard'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id as ElevateTab)}
            className={`px-4 py-2 rounded-full text-xs font-black shrink-0 ${tab === id ? 'bg-[color:var(--color-text)] text-[color:var(--color-primary)]' : 'bg-[color:var(--color-well)] text-[color:var(--color-text)]'}`}
          >{label}</button>
        ))}
      </div>
      <div className="rounded-3xl p-1">
        {tab === 'market' && <WairoElevateMarket />}
        {tab === 'ledger' && <WairoElevateLedger />}
        {tab === 'onboard' && <WairoElevateOnboard />}
      </div>
      <p className="text-[11px] text-center" style={{ color: 'var(--color-text-faint)' }}>
        Elevate pages are Wairo features — and remain standalone at <span className="font-mono">/home/user/lumina/</span>.
      </p>
    </div>
  );
};

export default ElevateHub;
