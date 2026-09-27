import React, { useState } from 'react';
import { Plus, Trash2, ChevronDown } from 'lucide-react';
import type { Festival } from '../../api/types';
import { soundEngine } from '../../utils/SoundEngine';

// ---------------------------------------------------------------------------
// FESTIVAL BUILDER — the owner-stated details behind a festival-style event
// page. Everything here is the organiser's own words, entered explicitly. An
// empty section is dropped, so the public page renders only what was actually
// filled in. Nothing is pre-filled with invented vendors, prices, or names.
// ---------------------------------------------------------------------------

const ROSE = '#E11D48';

const field = 'w-full px-3 py-2 rounded-lg text-[13px] border';
const fieldStyle = { borderColor: 'rgba(0,0,0,0.14)', background: '#fff' } as const;
const labelStyle = { fontSize: 12, fontWeight: 700, color: 'rgba(28,25,23,0.7)' } as const;

function strip(f: Festival): Festival | null {
  const out: Festival = {};
  if (f.lineup?.length) out.lineup = f.lineup;
  if (f.zones?.length) out.zones = f.zones;
  if (f.priceTiers?.length) out.priceTiers = f.priceTiers;
  if (f.daySchedules?.length) out.daySchedules = f.daySchedules;
  if (f.stages?.length) out.stages = f.stages;
  if (f.artists?.length) out.artists = f.artists;
  if (f.sponsors?.length) out.sponsors = f.sponsors;
  if (f.faqs?.length) out.faqs = f.faqs;
  return Object.keys(out).length > 0 ? out : null;
}

const Collapsible: React.FC<{ title: string; hint: string; count: number; open: boolean; onToggle: () => void; children: React.ReactNode }> = ({ title, hint, count, open, onToggle, children }) => (
  <div className="rounded-xl border" style={{ borderColor: 'rgba(0,0,0,0.1)' }}>
    <button type="button" onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 cursor-pointer">
      <span className="text-left">
        <span className="text-[14px] font-black" style={{ color: '#1C1917' }}>{title}{count > 0 ? ` · ${count}` : ''}</span>
        <span className="block text-[11px]" style={{ color: 'rgba(28,25,23,0.55)' }}>{hint}</span>
      </span>
      <ChevronDown className={`w-5 h-5 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: ROSE }} />
    </button>
    {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
  </div>
);

const AddBtn: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button type="button" onClick={() => { soundEngine.play('tap'); onClick(); }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[12px] font-bold cursor-pointer" style={{ background: '#1C1917', color: '#fff' }}>
    <Plus className="w-3.5 h-3.5" /> {label}
  </button>
);
const DelBtn: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button type="button" aria-label="Remove" onClick={() => { soundEngine.play('tap'); onClick(); }} className="p-2 rounded-full cursor-pointer" style={{ color: ROSE, background: 'rgba(225,29,72,0.08)' }}>
    <Trash2 className="w-4 h-4" />
  </button>
);

export const FestivalBuilder: React.FC<{ value: Festival | null; onChange: (f: Festival | null) => void }> = ({ value, onChange }) => {
  const v = value ?? {};
  const [open, setOpen] = useState<string | null>(null);
  const set = (patch: Partial<Festival>) => onChange({ ...v, ...patch });
  const up = (key: keyof Festival, i: number, patch: Record<string, unknown>) => {
    const arr = [...((v[key] as any[]) ?? [])];
    arr[i] = { ...arr[i], ...patch };
    set({ [key]: arr } as any);
  };
  const del = (key: keyof Festival, i: number) => {
    const arr = [...((v[key] as any[]) ?? [])];
    arr.splice(i, 1);
    set({ [key]: arr } as any);
  };
  const add = (key: keyof Festival, entry: Record<string, unknown>) => {
    const arr = [...((v[key] as any[]) ?? [])];
    arr.push(entry);
    set({ [key]: arr } as any);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border p-3" style={{ borderColor: 'rgba(0,0,0,0.1)' }}>
        <label style={labelStyle} className="block mb-1.5">
          What's included (per person) — one per line
        </label>
        <textarea
          rows={3}
          placeholder={'Transport\nMeals\nSleeping / camping\nGear'}
          value={(v.inclusions ?? []).join('\n')}
          onChange={(e) => set({ inclusions: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
          className="w-full px-3 py-2 rounded-lg text-[13px] border resize-none"
          style={fieldStyle}
        />
        <p className="mt-1.5" style={{ ...labelStyle, color: 'rgba(28,25,23,0.45)' }}>
          Shown as “What’s included” next to the per-person price — e.g. a safari team covering transport, food and sleeping.
        </p>
      </div>

      <Collapsible title="Lineup" hint="The stalls or trucks you're naming" count={(v.lineup ?? []).length} open={open === 'lineup'} onToggle={() => setOpen(open === 'lineup' ? null : 'lineup')}>
        {(v.lineup ?? []).map((l, i) => (
          <div key={i} className="flex gap-2 items-start">
            <div className="flex-1 space-y-2">
              <input className={field} style={fieldStyle} placeholder="Stall name" value={l.name ?? ''} onChange={(e) => up('lineup', i, { name: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <input className={field} style={fieldStyle} placeholder="Cuisine tag (e.g. Mexican)" value={l.tag ?? ''} onChange={(e) => up('lineup', i, { tag: e.target.value })} />
                <input className={field} style={fieldStyle} placeholder="Zone (e.g. Zone A)" value={l.zone ?? ''} onChange={(e) => up('lineup', i, { zone: e.target.value })} />
              </div>
              <input className={field} style={fieldStyle} placeholder="What they serve" value={l.description ?? ''} onChange={(e) => up('lineup', i, { description: e.target.value })} />
            </div>
            <DelBtn onClick={() => del('lineup', i)} />
          </div>
        ))}
        <AddBtn label="Add a stall" onClick={() => add('lineup', { name: '', tag: '', description: '', zone: '' })} />
      </Collapsible>

      <Collapsible title="Zones" hint="Named areas on the map" count={(v.zones ?? []).length} open={open === 'zones'} onToggle={() => setOpen(open === 'zones' ? null : 'zones')}>
        {(v.zones ?? []).map((z, i) => (
          <div key={i} className="flex gap-2 items-start">
            <div className="flex-1 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input className={field} style={fieldStyle} placeholder="Zone name (e.g. Zone A)" value={z.name ?? ''} onChange={(e) => up('zones', i, { name: e.target.value })} />
                <input className={field} style={fieldStyle} placeholder="Colour (optional)" value={z.color ?? ''} onChange={(e) => up('zones', i, { color: e.target.value })} />
              </div>
              <input className={field} style={fieldStyle} placeholder="What's in this zone" value={z.description ?? ''} onChange={(e) => up('zones', i, { description: e.target.value })} />
            </div>
            <DelBtn onClick={() => del('zones', i)} />
          </div>
        ))}
        <AddBtn label="Add a zone" onClick={() => add('zones', { name: '', description: '', color: '' })} />
      </Collapsible>

      <Collapsible title="Ticket tiers" hint="The prices you're stating" count={(v.priceTiers ?? []).length} open={open === 'priceTiers'} onToggle={() => setOpen(open === 'priceTiers' ? null : 'priceTiers')}>
        {(v.priceTiers ?? []).map((t, i) => (
          <div key={i} className="flex gap-2 items-start">
            <div className="flex-1 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input className={field} style={fieldStyle} placeholder="Tier name (e.g. Weekend Pass)" value={t.name ?? ''} onChange={(e) => up('priceTiers', i, { name: e.target.value })} />
                <input className={field} style={fieldStyle} type="number" min={0} placeholder="Price (KES)" value={t.price ?? ''} onChange={(e) => up('priceTiers', i, { price: e.target.value === '' ? null : Number(e.target.value) })} />
              </div>
              <input className={field} style={fieldStyle} placeholder="Perks, one per line" value={(t.perks ?? []).join('\n')} onChange={(e) => up('priceTiers', i, { perks: e.target.value.split('\n') })} />
              <input className={field} style={fieldStyle} placeholder="Badge (optional, e.g. Best Value)" value={t.badge ?? ''} onChange={(e) => up('priceTiers', i, { badge: e.target.value })} />
            </div>
            <DelBtn onClick={() => del('priceTiers', i)} />
          </div>
        ))}
        <AddBtn label="Add a tier" onClick={() => add('priceTiers', { name: '', price: null, currency: 'KES', perks: [], badge: '' })} />
      </Collapsible>

      <Collapsible title="Daily schedule" hint="Per-day timeline" count={(v.daySchedules ?? []).length} open={open === 'daySchedules'} onToggle={() => setOpen(open === 'daySchedules' ? null : 'daySchedules')}>
        {(v.daySchedules ?? []).map((d, i) => (
          <div key={i} className="flex gap-2 items-start">
            <div className="flex-1 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input className={field} style={fieldStyle} placeholder="Day (e.g. Fri Jul 25)" value={d.day ?? ''} onChange={(e) => up('daySchedules', i, { day: e.target.value })} />
                <input className={field} style={fieldStyle} placeholder="Label (optional)" value={d.label ?? ''} onChange={(e) => up('daySchedules', i, { label: e.target.value })} />
              </div>
              {(d.items ?? []).map((it, j) => (
                <div key={j} className="flex gap-2 items-start pl-2">
                  <div className="flex-1 grid grid-cols-[70px_1fr] gap-2">
                    <input className={field} style={fieldStyle} placeholder="Time" value={it.at ?? ''} onChange={(e) => { const items = [...d.items]; items[j] = { ...it, at: e.target.value }; up('daySchedules', i, { items }); }} />
                    <input className={field} style={fieldStyle} placeholder="What (e.g. Gates open)" value={it.title ?? ''} onChange={(e) => { const items = [...d.items]; items[j] = { ...it, title: e.target.value }; up('daySchedules', i, { items }); }} />
                  </div>
                  <button type="button" aria-label="Remove item" onClick={() => { const items = [...d.items]; items.splice(j, 1); up('daySchedules', i, { items }); }} className="p-1 cursor-pointer" style={{ color: ROSE }}><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              <button type="button" onClick={() => up('daySchedules', i, { items: [...(d.items ?? []), { at: '', title: '' }] })} className="text-[11px] font-bold cursor-pointer" style={{ color: ROSE }}>+ add a time</button>
            </div>
            <DelBtn onClick={() => del('daySchedules', i)} />
          </div>
        ))}
        <AddBtn label="Add a day" onClick={() => add('daySchedules', { day: '', label: '', items: [] })} />
      </Collapsible>

      <Collapsible title="Music" hint="The artists you're stating" count={(v.artists ?? []).length} open={open === 'artists'} onToggle={() => setOpen(open === 'artists' ? null : 'artists')}>
        {(v.artists ?? []).map((a, i) => (
          <div key={i} className="flex gap-2 items-start">
            <div className="flex-1 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input className={field} style={fieldStyle} placeholder="Artist name" value={a.name ?? ''} onChange={(e) => up('artists', i, { name: e.target.value })} />
                <input className={field} style={fieldStyle} placeholder="Day / slot (e.g. Sat headliner)" value={a.day ?? ''} onChange={(e) => up('artists', i, { day: e.target.value })} />
              </div>
              <input className={field} style={fieldStyle} placeholder="Description" value={a.description ?? ''} onChange={(e) => up('artists', i, { description: e.target.value })} />
              <input className={field} style={fieldStyle} placeholder="Link (optional — a real link only)" value={a.url ?? ''} onChange={(e) => up('artists', i, { url: e.target.value })} />
            </div>
            <DelBtn onClick={() => del('artists', i)} />
          </div>
        ))}
        <AddBtn label="Add an artist" onClick={() => add('artists', { name: '', day: '', description: '', url: '' })} />
      </Collapsible>

      <Collapsible title="Sponsors" hint="Names only — no logos" count={(v.sponsors ?? []).length} open={open === 'sponsors'} onToggle={() => setOpen(open === 'sponsors' ? null : 'sponsors')}>
        {(v.sponsors ?? []).map((s, i) => (
          <div key={i} className="flex gap-2 items-start">
            <div className="flex-1 grid grid-cols-2 gap-2">
              <input className={field} style={fieldStyle} placeholder="Name" value={s.name ?? ''} onChange={(e) => up('sponsors', i, { name: e.target.value })} />
              <input className={field} style={fieldStyle} placeholder="Tier (e.g. Gold)" value={s.tier ?? ''} onChange={(e) => up('sponsors', i, { tier: e.target.value })} />
            </div>
            <DelBtn onClick={() => del('sponsors', i)} />
          </div>
        ))}
        <AddBtn label="Add a sponsor" onClick={() => add('sponsors', { name: '', tier: '' })} />
      </Collapsible>

      <Collapsible title="FAQ" hint="The questions you're answering" count={(v.faqs ?? []).length} open={open === 'faqs'} onToggle={() => setOpen(open === 'faqs' ? null : 'faqs')}>
        {(v.faqs ?? []).map((f, i) => (
          <div key={i} className="flex gap-2 items-start">
            <div className="flex-1 space-y-2">
              <input className={field} style={fieldStyle} placeholder="Question" value={f.q ?? ''} onChange={(e) => up('faqs', i, { q: e.target.value })} />
              <textarea className={field} style={fieldStyle} rows={2} placeholder="Answer" value={f.a ?? ''} onChange={(e) => up('faqs', i, { a: e.target.value })} />
            </div>
            <DelBtn onClick={() => del('faqs', i)} />
          </div>
        ))}
        <AddBtn label="Add a question" onClick={() => add('faqs', { q: '', a: '' })} />
      </Collapsible>
    </div>
  );
};

export const assembleFestival = (f: Festival | null): Festival | null => strip(f ?? {});
export default FestivalBuilder;
