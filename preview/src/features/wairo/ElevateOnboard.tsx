import React from 'react';

// Wairo Elevate — Onboard (integrated)
// Standalone: /home/user/lumina/ElevateOnboard.tsx

export const WairoElevateOnboard: React.FC<{ onStart?: () => void }> = ({ onStart }) => {
  return (
    <div className="space-y-6">
      <header className="shop-endplate">
        <div>
          <p className="!text-xs uppercase tracking-widest mb-2">Wairo · Elevate · Onboard</p>
          <h1>From zero to shop<br />in four taps.</h1>
          <p className="mt-3">Name, cover, category, open — no product required to start.</p>
        </div>
      </header>

      <ol className="space-y-3">
        {[
          ['Name & cover', 'What the street will read on your awning.'],
          ['Category', 'One arm of the business — stated, not verified, changeable.'],
          ['Visibility', 'Private stays private; public gets a real public page on the next read.'],
          ['Invite & open', 'The first customer gets a link they can actually open.'],
        ].map(([t, d], i) => (
          <li key={t} className="flex gap-3 rounded-2xl p-4 bg-[var(--color-paper)] items-start" style={{ boxShadow: 'var(--room-light), var(--lift-1)' }}>
            <span className="w-8 h-8 rounded-full grid place-items-center text-xs font-black shrink-0" style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}>{i + 1}</span>
            <div>
              <p className="text-sm font-bold" style={{ color: 'var(--brief-ink)' }}>{t}</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{d}</p>
            </div>
          </li>
        ))}
      </ol>

      {onStart && (
        <button type="button" onClick={onStart} className="w-full py-3 rounded-2xl text-sm font-black" style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}>
          Start your shop
        </button>
      )}

      <p className="text-[11px] text-center" style={{ color: 'var(--color-text-faint)' }}>
        Standalone at <span className="font-mono">/home/user/lumina/ElevateOnboard.tsx</span> — also a Wairo feature at <span className="font-mono">you/elevateOnboard</span>.
      </p>
    </div>
  );
};

export default WairoElevateOnboard;
