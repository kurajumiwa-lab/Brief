import React, { useState } from 'react';
import { Image, ClipboardList, X, Check } from 'lucide-react';
import * as briefApi from '../../api/briefApi';
import { ImageField } from '../../components/ImageField';
import { soundEngine } from '../../utils/SoundEngine';

// ---------------------------------------------------------------------------
// STOCK ADD SHEET — the two honest ways stock gets on the shelf.
//
//   1. PHOTO + NOTE — take a picture, type the name and the price, done.
//      The photo is the item's proof of existence; the note is what it is.
//      No ten-field form between a trader and their own shelf.
//
//   2. TEMPLATE — the common items of a shop type, as NAMES ONLY. The seller
//      prices the ones they actually stock; blank lines are skipped, never
//      filled with a number the app would have had to invent.
//
// Both paths write through the real space-offer loop: the row is created
// (draft) and then published, the same way the full form does. If a publish
// is refused, the refusal is shown word for word and the loop stays open.
// ---------------------------------------------------------------------------

const TEMPLATES: Array<{ id: string; label: string; items: string[] }> = [
  {
    id: 'general',
    label: 'General store',
    items: ['500ml cooking oil', '1kg sugar', '500g red tea', '2kg maize flour', '500ml dish soap', '2kg washing soap', '1L milk', '1kg salt', '100g matches', '1 roll tissue']
  },
  {
    id: 'food',
    label: 'Food & beverages',
    items: ['1L milk', '500g maize flour', '1kg rice', '1L cooking oil', '500g green lentils', '1kg sugar', '1L tomato sauce', '500g beans', '100g red tea', '500g githeri mix']
  },
  {
    id: 'household',
    label: 'Household & cleaning',
    items: ['500ml dish soap', '2kg washing soap', '1L floor cleaner', '1 roll tissue', '100g matches', '1L disinfectant', '500ml surface cleaner', '1 pack sponges', '1 roll garbage bags', '1L air freshener']
  }
];

export interface StockAddSheetProps {
  spaceId: string;
  onClose: () => void;
  /** Called after the writes land, so the parent can re-read the shelf. */
  onAdded: (count: number) => void;
}

export const StockAddSheet: React.FC<StockAddSheetProps> = ({ spaceId, onClose, onAdded }) => {
  const [tab, setTab] = useState<'photo' | 'template'>('photo');

  // Photo + note
  const [photo, setPhoto] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Template
  const [tplId, setTplId] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [tplBusy, setTplBusy] = useState(false);
  const [tplError, setTplError] = useState('');

  const tpl = TEMPLATES.find((t) => t.id === tplId) ?? null;

  const submitOne = async () => {
    const p = Number(price);
    if (!title.trim()) { setError('Give the item a name.'); return; }
    if (!Number.isFinite(p) || p <= 0) { setError('The price must be a number above zero.'); return; }
    setBusy(true);
    setError('');
    try {
      const created = await briefApi.createSpaceOffer(spaceId, {
        title: title.trim(),
        price: p,
        type: 'product',
        images: photo ? [photo] : [],
        description: note.trim() || undefined
      });
      if (!created.ok) { setError(created.error ?? 'The item could not be added.'); return; }
      const published = await briefApi.publishSpaceOffer(spaceId, created.data.offer.id);
      if (!published.ok) {
        // The draft exists; say so instead of pretending nothing happened.
        setError(`Added as a draft, but publishing was refused: ${published.error ?? 'unknown reason'}.`);
        return;
      }
      soundEngine.play('reward');
      onAdded(1);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong adding the item.');
    } finally {
      setBusy(false);
    }
  };

  const submitTemplate = async () => {
    if (!tpl) return;
    const priced = tpl.items.filter((it) => {
      const v = Number(prices[it]);
      return prices[it] !== '' && Number.isFinite(v) && v > 0;
    });
    if (priced.length === 0) { setTplError('Price at least one item — blank lines are skipped, never filled in.'); return; }
    setTplBusy(true);
    setTplError('');
    let added = 0;
    const failures: string[] = [];
    for (const it of priced) {
      const created = await briefApi.createSpaceOffer(spaceId, { title: it, price: Number(prices[it]), type: 'product' });
      if (!created.ok) { failures.push(`${it}: ${created.error ?? 'refused'}`); continue; }
      const published = await briefApi.publishSpaceOffer(spaceId, created.data.offer.id);
      if (!published.ok) { failures.push(`${it}: draft added, publish refused (${published.error ?? 'unknown'})`); continue; }
      added += 1;
    }
    setTplBusy(false);
    if (added > 0) soundEngine.play('reward');
    if (failures.length > 0) {
      setTplError(failures.join(' · '));
      if (added > 0) { onAdded(added); onClose(); }
      return;
    }
    onAdded(added);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4 animate-fadeIn" role="dialog" aria-modal="true" aria-label="Add stock">
      <div className="w-full max-w-md bg-[color:var(--color-bg)] rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden" style={{ maxHeight: '92vh', overflowY: 'auto' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <div>
            <h3 className="text-base font-black tracking-tight" style={{ color: 'var(--color-text)' }}>Add stock</h3>
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Photo + note · Template</p>
          </div>
          <button type="button" onClick={onClose} className="w-9 h-9 rounded-2xl grid place-items-center cursor-pointer"
            style={{ background: 'var(--color-paper)', boxShadow: '0 2px 8px rgba(10,14,20,0.08)' }} aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 px-5 pb-3">
          <button type="button" onClick={() => { soundEngine.play('tap'); setTab('photo'); }}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-2xl text-[12px] font-black cursor-pointer"
            style={tab === 'photo' ? { background: '#0A0E14', color: '#EAB308' } : { background: 'var(--color-paper)', color: 'var(--color-text-muted)', boxShadow: '0 1px 6px rgba(10,14,20,0.07)' }}>
            <Image className="w-4 h-4" /> Photo + note
          </button>
          <button type="button" onClick={() => { soundEngine.play('tap'); setTab('template'); }}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-2xl text-[12px] font-black cursor-pointer"
            style={tab === 'template' ? { background: '#0A0E14', color: '#EAB308' } : { background: 'var(--color-paper)', color: 'var(--color-text-muted)', boxShadow: '0 1px 6px rgba(10,14,20,0.07)' }}>
            <ClipboardList className="w-4 h-4" /> Template
          </button>
        </div>

        <div className="px-5 pb-6">
          {tab === 'photo' && (
            <div className="space-y-3">
              <ImageField label="Photo of the item" hint="The shelf shows this first" value={photo} onChange={(u) => setPhoto(u)} compact />
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Item name (e.g. 500ml cooking oil)"
                className="w-full px-3.5 py-3 rounded-2xl text-[13px] font-semibold bg-[color:var(--color-paper)] border-0 focus:outline-none"
                style={{ boxShadow: 'inset 0 0 0 1px var(--color-hairline, #DCE1E8)' }}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  placeholder="Price (KES)"
                  className="w-full px-3.5 py-3 rounded-2xl text-[13px] font-semibold bg-[color:var(--color-paper)] border-0 focus:outline-none"
                  style={{ boxShadow: 'inset 0 0 0 1px var(--color-hairline, #DCE1E8)' }}
                />
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Note (optional)"
                  className="w-full px-3.5 py-3 rounded-2xl text-[13px] font-semibold bg-[color:var(--color-paper)] border-0 focus:outline-none"
                  style={{ boxShadow: 'inset 0 0 0 1px var(--color-hairline, #DCE1E8)' }}
                />
              </div>
              {error && <p className="text-[12px] font-bold" role="alert" style={{ color: '#DC2626' }}>{error}</p>}
              <button
                type="button"
                onClick={submitOne}
                disabled={busy}
                className="w-full py-3 rounded-2xl text-[13px] font-black cursor-pointer disabled:opacity-60"
                style={{ background: '#0A0E14', color: '#EAB308' }}
              >
                {busy ? 'Adding…' : 'Add to my stock'}
              </button>
              <p className="text-[11px] font-semibold text-center" style={{ color: 'var(--color-text-muted)' }}>
                Saved as an active listing — buyers see it the moment it lands.
              </p>
            </div>
          )}

          {tab === 'template' && (
            <div className="space-y-3">
              {!tpl ? (
                <div className="space-y-2">
                  {TEMPLATES.map((t) => (
                    <button key={t.id} type="button" onClick={() => { soundEngine.play('tap'); setTplId(t.id); setPrices({}); }}
                      className="w-full text-left px-4 py-3 rounded-2xl cursor-pointer"
                      style={{ background: 'var(--color-paper)', boxShadow: '0 2px 10px rgba(10,14,20,0.05)' }}>
                      <p className="text-[13px] font-black" style={{ color: 'var(--color-text)' }}>{t.label}</p>
                      <p className="text-[11px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>{t.items.length} common items · you price the ones you have</p>
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-black" style={{ color: 'var(--color-text)' }}>{tpl.label}</p>
                    <button type="button" onClick={() => setTplId(null)} className="text-[11px] font-black underline cursor-pointer" style={{ color: 'var(--color-text-muted)' }}>
                      Change
                    </button>
                  </div>
                  <div className="rounded-3xl overflow-hidden" style={{ background: 'var(--color-paper)', boxShadow: '0 2px 10px rgba(10,14,20,0.05)' }}>
                    {tpl.items.map((it, i) => (
                      <div key={it} className={`flex items-center gap-2 px-3.5 py-2.5 ${i > 0 ? 'border-t' : ''}`} style={{ borderColor: '#EEF1F5' }}>
                        <p className="flex-1 text-[13px] font-semibold truncate" style={{ color: 'var(--color-text)' }}>{it}</p>
                        <span className="text-[11px] font-bold" style={{ color: 'var(--color-text-muted)' }}>KES</span>
                        <input
                          value={prices[it] ?? ''}
                          onChange={(e) => setPrices((m) => ({ ...m, [it]: e.target.value }))}
                          type="number"
                          inputMode="numeric"
                          min="0"
                          placeholder="—"
                          className="w-24 px-2.5 py-1.5 rounded-xl text-[13px] font-bold text-right tabular-nums bg-[color:var(--color-bg)] border-0 focus:outline-none"
                          style={{ boxShadow: 'inset 0 0 0 1px var(--color-hairline, #DCE1E8)' }}
                        />
                      </div>
                    ))}
                  </div>
                  {tplError && <p className="text-[12px] font-bold" role="alert" style={{ color: '#DC2626' }}>{tplError}</p>}
                  <button
                    type="button"
                    onClick={submitTemplate}
                    disabled={tplBusy}
                    className="w-full py-3 rounded-2xl text-[13px] font-black inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                    style={{ background: '#0A0E14', color: '#EAB308' }}
                  >
                    {tplBusy ? 'Adding…' : (
                      <>
                        <Check className="w-4 h-4" />
                        Add {tpl.items.filter((it) => { const v = Number(prices[it]); return prices[it] !== '' && Number.isFinite(v) && v > 0; }).length} priced items
                      </>
                    )}
                  </button>
                  <p className="text-[11px] font-semibold text-center" style={{ color: 'var(--color-text-muted)' }}>
                    Names only — prices are yours to state. Blank lines are skipped.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StockAddSheet;
