import React from 'react';

// ---------------------------------------------------------------------------
// Wairo Elevate — Market (integrated)
// Standalone source lives at /home/user/lumina/ElevateMarket.tsx.
// This file is the Wairo integration: it is the same experience, mounted
// inside Brief's shell (as a You section / drawer destination), so the member
// does not leave Wairo to reach it. The standalone copy stays at /home/user/lumina/
// — this is an integration, not a move.
// ---------------------------------------------------------------------------

export const WairoElevateMarket: React.FC = () => {
  return (
    <div className="space-y-6">
      <header className="shop-endplate">
        <div>
          <p className="!text-xs uppercase tracking-widest mb-2">Wairo · Elevate · Market</p>
          <h1>Wholesale without<br />the guessing.</h1>
          <p className="mt-3">Direct and bulk sourcing, counted by the row — not by a badge.</p>
        </div>
      </header>

      <section className="rounded-3xl p-5 bg-[var(--color-paper)] space-y-3" style={{ boxShadow: 'var(--room-light), var(--lift-2)' }}>
        <h2 className="text-[15px] font-black" style={{ color: 'var(--brief-ink)' }}>What Elevate adds to the market</h2>
        <ul className="text-[13px] leading-relaxed list-disc pl-5" style={{ color: 'var(--color-text-muted)' }}>
          <li>Fresh provenance on every listing (producer → route → shop, stated plainly).</li>
          <li>Volume clarity: real minimums, real units, real origins — never inferred.</li>
          <li>One-tap reorder from a settled work order — the shop remembers for you.</li>
          <li>Integrated in Wairo: the same standalone file at <span className="font-mono">/home/user/lumina/ElevateMarket.tsx</span> powers this view.</li>
        </ul>
      </section>

      <section className="rounded-2xl p-4 bg-[var(--color-well)]">
        <p className="text-[11px] font-black uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Where it lives</p>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
          Standalone preview: <span className="font-mono">/home/user/lumina/index.html</span> · Wairo shell: <span className="font-mono">you/elevateMarket</span> and drawer — same rows, two doors.
        </p>
      </section>
    </div>
  );
};

export default WairoElevateMarket;
