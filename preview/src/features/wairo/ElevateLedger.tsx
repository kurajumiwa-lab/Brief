import React from 'react';

// Wairo Elevate — Ledger (integrated)
// Standalone: /home/user/lumina/ElevateLedger.tsx

export const WairoElevateLedger: React.FC = () => {
  return (
    <div className="space-y-6">
      <header className="shop-endplate">
        <div>
          <p className="!text-xs uppercase tracking-widest mb-2">Wairo · Elevate · Ledger</p>
          <h1>Money, stated<br />once and derived.</h1>
          <p className="mt-3">Every KES you see is a ledger row — not a cached balance waiting to disagree.</p>
        </div>
      </header>

      <section className="rounded-3xl p-5 bg-[var(--color-paper)]" style={{ boxShadow: 'var(--room-light), var(--lift-2)' }}>
        <h2 className="text-[15px] font-black" style={{ color: 'var(--brief-ink)' }}>The trail</h2>
        <div className="mt-3 space-y-2">
          {[
            ['Held', 'Group-buy and frozen ticket rows still in escrow — KES counted, not moved.'],
            ['Settled', 'Ledger transaction marked settled by finance — the only number Brief calls money.'],
            ['Export', 'CSV of settled rows for the SACCO book — one tap, no second source.'],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-3">
              <span className="text-xs font-black uppercase tracking-wider shrink-0" style={{ color: 'var(--color-primary)' }}>{k}</span>
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{v}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] mt-3" style={{ color: 'var(--color-text-faint)' }}>
          Standalone source: <span className="font-mono">/home/user/lumina/ElevateLedger.tsx</span> — integrated here as a Wairo feature.
        </p>
      </section>
    </div>
  );
};

export default WairoElevateLedger;
