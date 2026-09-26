import React from 'react';
import { Plus, Trash2, Copy, ExternalLink, Send, ShieldCheck, Store, BookOpen } from 'lucide-react';
import * as briefApi from '../api/briefApi';
import type { ShopView, ShopItem, ShopBook } from '../api/briefApi';


// --- THE DUKA BOOK: the paper-ledger replacement, derived -------------------
//
// Brief never claims to see inside WhatsApp. The book holds what the
// shopkeeper logs — 3 fields — and derives today, the week, top items and
// low stock. A logged sale carries a clientKey so the OFFLINE QUEUE can
// replay it safely when the signal returns.
function TheBook({ items, onQueued }: { items: { name: string; priceKes: string }[]; onQueued?: (n: number) => void }) {
  const [book, setBook] = React.useState<ShopBook | null>(null);
  const [name, setName] = React.useState('');
  const [qty, setQty] = React.useState('1');
  const [note, setNote] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const r = await briefApi.getMyBook();
    if (r.ok) setBook(r.data);
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const log = async () => {
    if (busy || !name.trim()) return;
    setBusy(true); setNote(null);
    const item = items.find((i) => i.name === name);
    const res = await briefApi.logShopSale({
      name: name.trim(),
      qty: Number(qty) || 1,
      unitKes: item ? Number(item.priceKes) : undefined as unknown as number,
      clientKey: `sale_${name.trim()}_${Date.now().toString(36)}`
    });
    setBusy(false);
    if (res.ok) {
      setNote(res.data.replayed ? 'Already recorded — nothing doubled.' : 'Logged.');
      setQty('1');
      await load();
      return;
    }
    // undefined unitKes when the item is not on the list: ask for the price.
    if (/unit price/.test(res.error)) {
      const typed = window.prompt(`${name.trim()} is not on your price list — what did it sell for (KES)?`);
      if (!typed) return;
      setBusy(true);
      const retry = await briefApi.logShopSale({ name: name.trim(), qty: Number(qty) || 1, unitKes: Number(typed.replace(/[^\d]/g, '')), clientKey: `sale_${name.trim()}_${Date.now().toString(36)}` });
      setBusy(false);
      if (retry.ok) { setNote('Logged.'); setQty('1'); await load(); return; }
      if ((retry as { queued?: boolean }).queued) { setNote('Offline — queued. It will send itself when you reconnect.'); onQueued?.(briefApi.offlineQueueDepth()); return; }
      setNote(retry.error);
      return;
    }
    if ((res as { queued?: boolean }).queued) {
      setNote('Offline — queued. It will send itself when you reconnect.');
      onQueued?.(briefApi.offlineQueueDepth());
      return;
    }
    setNote(res.error);
  };

  const kes = (n: number) => `KES ${n.toLocaleString()}`;

  return (
    <section aria-label="The book" className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-[#40916C]" aria-hidden="true" />
        <h3 className="text-[14px] font-extrabold text-[var(--brief-ink)]">The book</h3>
        {book && <span className="text-[11px] text-[var(--ink-60)] ml-auto">derived, never stored</span>}
      </div>

      {book ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Today', d: book.today },
              { label: 'Yesterday', d: book.yesterday },
              { label: '7 days', d: book.week }
            ].map(({ label, d }) => (
              <div key={label} className="rounded-xl bg-[color:var(--color-well)] px-2.5 py-2">
                <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--ink-70)]">{label}</p>
                <p className="text-[14px] font-extrabold text-[var(--brief-ink)] mt-0.5 truncate">{kes(d.kes)}</p>
                <p className="text-[11px] text-[var(--ink-55)]">{d.sales} sale{d.sales === 1 ? '' : 's'} · {d.items} item{d.items === 1 ? '' : 's'}</p>
              </div>
            ))}
          </div>

          {book.topItems.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {book.topItems.map((t, i) => (
                <span key={t.name} className="px-2 py-0.5 rounded-full bg-[color:var(--color-well)] text-[11px] font-bold text-[var(--ink-70)]">
                  {i === 0 ? '🔥 ' : ''}{t.name} ×{t.qty}
                </span>
              ))}
            </div>
          )}

          {book.lowStock.length > 0 && (
            <p className="text-[11px] font-bold text-[#DC2626]">
              Low stock: {book.lowStock.map((i) => `${i.name} (${i.remaining})`).join(' · ')}
            </p>
          )}

          <div className="flex items-center gap-1.5 pt-1 border-t border-[var(--brief-line)]">
            <input list="book-items" value={name} onChange={(e) => setName(e.target.value)} placeholder="What sold?" maxLength={60}
              className="flex-1 min-w-0 rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-2.5 py-1.5 text-[13px] font-bold text-[var(--brief-ink)] outline-none focus:border-[#40916C]" />
            <datalist id="book-items">
              {items.map((i) => <option key={i.name} value={i.name} />)}
            </datalist>
            <input value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ''))} placeholder="1" inputMode="numeric"
              className="w-12 rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-2 py-1.5 text-[13px] text-[var(--brief-ink)] outline-none focus:border-[#40916C]" aria-label="quantity" />
            <button type="button" onClick={() => void log()} disabled={busy || !name.trim()}
              className="rounded-lg bg-[#40916C] px-3 py-1.5 text-[12px] font-extrabold text-[var(--accent-ink)] disabled:opacity-40 cursor-pointer">Log</button>
          </div>
          {note && <p role="status" className="text-[11px] font-bold text-[#059669]">{note}</p>}
          <p className="text-[11px] text-[var(--ink-60)] leading-snug">{book.note}</p>
        </>
      ) : (
        <p className="text-[12px] text-[var(--ink-55)]">Save the shop and the book opens — today, the week, what is moving, what is low.</p>
      )}
    </section>
  );
}

// --- POOL A RESTOCK: the Shop ↔ Group Buy bridge -----------------------------
function PoolACard({ items }: { items: { name: string; priceKes: string }[] }) {
  const [itemName, setItemName] = React.useState('');
  const [unitCost, setUnitCost] = React.useState('');
  const [goal, setGoal] = React.useState('');
  const [mine, setMine] = React.useState('');
  const [out, setOut] = React.useState<{ text: string; waMe: string; target: number; total: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const pool = async () => {
    if (busy) return;
    setBusy(true); setError(null); setOut(null);
    const res = await briefApi.poolRestock({ itemName, unitCostKes: Number(unitCost), goalUnits: Number(goal), myUnits: Number(mine) });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setOut({ text: res.data.share.text, waMe: res.data.share.waMe, target: res.data.pool.targetAmount, total: res.data.pool.total });
  };

  return (
    <section aria-label="Pool a restock" className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-extrabold text-[var(--brief-ink)]">Pool a restock</h3>
        <span className="text-[11px] text-[var(--ink-60)]">bulk price, pooled demand</span>
      </div>
      <p className="text-[11px] text-[var(--ink-60)] leading-snug">
        Pick an item you sell, say the bulk unit cost and a goal. Brief opens a Group Buy — other shops pool in, and everyone buys at the bulk price.
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        <input list="book-items" value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Item (from your list)" maxLength={60}
          className="col-span-2 rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-2.5 py-1.5 text-[13px] font-bold text-[var(--brief-ink)] outline-none focus:border-[#40916C]" />
        <input value={unitCost} onChange={(e) => setUnitCost(e.target.value.replace(/[^\d]/g, ''))} placeholder="Bulk cost/unit (KES)" inputMode="numeric"
          className="rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-2.5 py-1.5 text-[13px] text-[var(--brief-ink)] outline-none focus:border-[#40916C]" aria-label="bulk unit cost in shillings" />
        <input value={goal} onChange={(e) => setGoal(e.target.value.replace(/[^\d]/g, ''))} placeholder="Goal (units)" inputMode="numeric"
          className="rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-2.5 py-1.5 text-[13px] text-[var(--brief-ink)] outline-none focus:border-[#40916C]" aria-label="goal units" />
        <input value={mine} onChange={(e) => setMine(e.target.value.replace(/[^\d]/g, ''))} placeholder="Your units" inputMode="numeric"
          className="rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-2.5 py-1.5 text-[13px] text-[var(--brief-ink)] outline-none focus:border-[#40916C]" aria-label="your pledged units" />
        <button type="button" onClick={() => void pool()} disabled={busy || !itemName || !unitCost || !goal || !mine}
          className="rounded-lg bg-[#40916C] px-3 py-1.5 text-[12px] font-extrabold text-[var(--accent-ink)] disabled:opacity-40 cursor-pointer">Open the pool</button>
      </div>
      {error && <p role="alert" className="text-[11px] font-bold text-[#DC2626]">{error}</p>}
      {out && (
        <div className="rounded-xl bg-[#EFF1F4] border border-[var(--brief-line)] p-2.5 space-y-1.5">
          <p className="text-[11px] font-bold text-[var(--brief-ink)]">Pool open — KES {out.total.toLocaleString()} of {out.target.toLocaleString()} pledged.</p>
          <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-[var(--brief-ink)] select-all">{out.text}</pre>
          <a href={out.waMe} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#40916C] px-3 py-1.5 text-[11px] font-extrabold text-[var(--accent-ink)] no-underline">
            <Send className="w-3 h-3" /> Call other shops on WhatsApp
          </a>
        </div>
      )}
    </section>
  );
}

// WHATSAPP SHOP BUILDER — Brief builds the shop, WhatsApp IS the shop.
// The preview on the right is the EXACT text (real WhatsApp formatting:
// *bold*, _italic_) that Copy puts on the clipboard and the wa.me link
// pre-fills. No payments flow through WhatsApp by design: buyers and
// sellers arrange money the way they already do. Brief's own fee is the
// store service, paid through the same manual Pochi flow as everything
// else and confirmed by an operator before publishing unlocks.
export function WhatsAppShopBuilder({ onOpenFees }: { onOpenFees: () => void }) {
  const [view, setView] = React.useState<ShopView | null>(null);
  const [name, setName] = React.useState('');
  const [tagline, setTagline] = React.useState('');
  const [orderNumber, setOrderNumber] = React.useState('');
  const [items, setItems] = React.useState<{ name: string; priceKes: string; note: string }[]>([{ name: '', priceKes: '', note: '' }]);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    void briefApi.getMyShop().then((r) => {
      if (!r.ok) return;
      const v = r.data;
      setView(v);
      if (v.shop.id) {
        setName(v.shop.name);
        setTagline(v.shop.tagline);
        setOrderNumber(v.shop.orderNumber);
        setItems(v.shop.items.map((i: ShopItem) => ({ name: i.name, priceKes: String(i.priceKes), note: i.note ?? '' })));
      }
    });
  }, []);

  const payload = () => ({
    name,
    tagline,
    orderNumber,
    items: items
      .filter((i) => i.name.trim() || i.priceKes.trim())
      .map((i) => ({ name: i.name.trim(), priceKes: Number(i.priceKes), note: i.note.trim() || undefined }))
  });

  const apply = (v: ShopView, when: string) => {
    setView(v);
    setNote(when);
    setError(null);
  };

  const save = async () => {
    if (busy) return;
    setBusy(true); setNote(null); setError(null);
    const res = await briefApi.saveMyShop(payload());
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    apply(res.data, 'Saved. The preview is exactly what customers will receive.');
  };

  const publish = async () => {
    if (busy) return;
    setBusy(true); setNote(null); setError(null);
    const res = await briefApi.publishMyShop();
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    apply(res.data, res.data.changed ? 'Published — the wa.me link is live to share.' : 'Already published.');
  };

  const unpublish = async () => {
    if (busy) return;
    setBusy(true);
    const res = await briefApi.unpublishMyShop();
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    apply(res.data, 'Back to draft. Old forwards keep working; new shares say draft.');
  };

  const copyText = async () => {
    if (!view?.share) return;
    try {
      await navigator.clipboard.writeText(view.share.text);
      setNote('Copied. Paste it into a WhatsApp status, broadcast or chat.');
    } catch {
      setError('Could not reach the clipboard — select the preview text and copy manually.');
    }
  };

  const published = view?.shop.status === 'published';
  const storeActive = view?.store.active === true;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Send className="w-4 h-4 text-[#40916C]" aria-hidden="true" />
          <h1 className="text-lg font-extrabold text-[var(--brief-ink)]">WhatsApp shop</h1>
          {published && (
            <span className="px-2 py-0.5 rounded-full bg-[#40916C] text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--accent-ink)]">Live</span>
          )}
        </div>
        <p className="text-[12px] text-[var(--ink-60)] leading-snug">
          Build the price list here; sell in the conversation. Copy the message or share the wa.me link — buyers reply in WhatsApp, and money is arranged between you (Pochi, till, send money). Brief never touches it.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {/* The builder */}
        <div className="space-y-3">
          <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-3">
            <label className="block space-y-1">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--ink-70)]">Shop name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Mama Njeria Fresh"
                className="w-full rounded-xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-3 py-2 text-[14px] font-bold text-[var(--brief-ink)] outline-none focus:border-[#40916C]" />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--ink-70)]">One line about it</span>
              <input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={60} placeholder="Fresh groceries, Kilimani"
                className="w-full rounded-xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-3 py-2 text-[13px] text-[var(--brief-ink)] outline-none focus:border-[#40916C]" />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--ink-70)]">WhatsApp number customers order on</span>
              <input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} maxLength={20} placeholder="+254 712 345 678" inputMode="tel"
                className="w-full rounded-xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-3 py-2 text-[14px] text-[var(--brief-ink)] outline-none focus:border-[#40916C]" />
            </label>
          </div>

          <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--ink-70)]">Price list</span>
              <span className="text-[11px] text-[var(--ink-60)]">{items.length} item{items.length === 1 ? '' : 's'} · keep it forwardable</span>
            </div>
            {items.map((item, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <input value={item.name} onChange={(e) => setItems(items.map((it, i) => i === idx ? { ...it, name: e.target.value } : it))} placeholder="Sukuma Wiki" maxLength={60}
                  className="flex-1 min-w-0 rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-2.5 py-1.5 text-[13px] font-bold text-[var(--brief-ink)] outline-none focus:border-[#40916C]" />
                <input value={item.priceKes} onChange={(e) => setItems(items.map((it, i) => i === idx ? { ...it, priceKes: e.target.value.replace(/[^\d]/g, '') } : it))} placeholder="50" inputMode="numeric"
                  className="w-16 rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-2 py-1.5 text-[13px] text-[var(--brief-ink)] outline-none focus:border-[#40916C]" aria-label={`price of item ${idx + 1} in shillings`} />
                <input value={item.note} onChange={(e) => setItems(items.map((it, i) => i === idx ? { ...it, note: e.target.value } : it))} placeholder="note (optional)" maxLength={40}
                  className="w-24 rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-2 py-1.5 text-[12px] text-[var(--ink-70)] outline-none focus:border-[#40916C]" aria-label={`note on item ${idx + 1}`} />
                <button type="button" onClick={() => setItems(items.filter((_, i) => i !== idx))} disabled={items.length === 1}
                  className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg text-[var(--ink-60)] hover:text-[#DC2626] disabled:opacity-30 cursor-pointer" aria-label={`remove item ${idx + 1}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setItems([...items, { name: '', priceKes: '', note: '' }])} disabled={items.length >= 40}
              className="w-full rounded-xl border border-dashed border-[var(--brief-line)] py-1.5 text-[12px] font-extrabold text-[#40916C] hover:border-[#40916C] disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1">
              <Plus className="w-3.5 h-3.5" /> Add an item
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void save()} disabled={busy}
              className="rounded-xl bg-[#40916C] px-4 py-2 text-[13px] font-extrabold text-[var(--accent-ink)] disabled:opacity-40 cursor-pointer">Save</button>
            {published ? (
              <button type="button" onClick={() => void unpublish()} disabled={busy}
                className="rounded-xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-4 py-2 text-[13px] font-extrabold text-[var(--brief-ink)] disabled:opacity-40 cursor-pointer">Unpublish</button>
            ) : (
              <button type="button" onClick={() => void publish()} disabled={busy}
                className="rounded-xl border border-[#40916C] bg-[color:var(--color-paper)] px-4 py-2 text-[13px] font-extrabold text-[#40916C] disabled:opacity-40 cursor-pointer">Publish</button>
            )}
          </div>

          {error && (
            <div role="alert" className="rounded-xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-3 py-2 flex items-start gap-2">
              <ShieldCheck className="w-3.5 h-3.5 text-[#DC2626] shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-[12px] text-[var(--brief-ink)] leading-snug">
                {error}
                {!storeActive && /store service/i.test(error) && (
                  <>
                    {' '}
                    <button type="button" onClick={onOpenFees} className="font-extrabold text-[#40916C] underline cursor-pointer">
                      Pay the store service (KES {view?.store.priceKes ?? 250}/month via Pochi) →
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          {note && <p role="status" className="text-[12px] font-bold text-[#059669]">{note}</p>}
        </div>

        {/* The output, exactly as WhatsApp will render the source */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Store className="w-3.5 h-3.5 text-[#40916C]" aria-hidden="true" />
            <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--ink-70)]">What customers receive</p>
          </div>
          {view?.share ? (
            <>
              <div className="rounded-2xl bg-[#EFF1F4] border border-[var(--brief-line)] p-3">
                <div className="rounded-xl rounded-tl-sm bg-[color:var(--color-paper)] border border-[rgba(220, 225, 232, 0.60)] p-3 max-h-[380px] overflow-y-auto">
                  <pre className="whitespace-pre-wrap font-sans text-[11.5px] leading-relaxed text-[var(--brief-ink)] select-all">{view.share.text}</pre>
                </div>
                <p className="mt-1.5 px-1 text-[11px] text-[var(--ink-70)]">*stars* render bold and _underscores_ italic in WhatsApp — this is the exact text.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void copyText()}
                  className="rounded-xl bg-[#40916C] px-3.5 py-2 text-[12px] font-extrabold text-[var(--accent-ink)] cursor-pointer flex items-center gap-1.5">
                  <Copy className="w-3.5 h-3.5" /> Copy message
                </button>
                <a href={view.share.waMe} target="_blank" rel="noreferrer"
                  className="rounded-xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-3.5 py-2 text-[12px] font-extrabold text-[var(--brief-ink)] cursor-pointer flex items-center gap-1.5 no-underline">
                  <ExternalLink className="w-3.5 h-3.5" /> Open the wa.me link
                </a>
              </div>
              {!view.share.shareable && (
                <p className="px-1 text-[11px] text-[var(--ink-55)] leading-snug">
                  Draft preview. Copying is yours to use, but the link is marked live only after you publish — publishing needs the store service below.
                </p>
              )}
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-[var(--brief-line)] p-4 text-[12px] text-[var(--ink-55)]">
              Save the shop and the exact WhatsApp message appears here.
            </div>
          )}

          <div className="rounded-2xl bg-[color:var(--color-paper)] border border-[var(--brief-line)] p-3.5 space-y-1">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--ink-70)]">Store service</p>
            {view?.store.active ? (
              <p className="text-[12px] font-bold text-[#059669]">Active until {new Date(view.store.activeUntil ?? '').toLocaleDateString()} — publishing is unlocked.</p>
            ) : (
              <>
                <p className="text-[12px] text-[var(--ink-70)] leading-snug">
                  Drafting is free. Publishing needs the store service — KES {view?.store.priceKes ?? 250}/month, paid via Pochi la Biashara and confirmed by an operator.
                </p>
                <button type="button" onClick={onOpenFees} className="text-[12px] font-extrabold text-[#40916C] underline cursor-pointer">
                  Pay the store service →
                </button>
              </>
            )}
            <p className="text-[11px] text-[var(--ink-70)] leading-snug pt-1 border-t border-[var(--brief-line)]">
              Photos belong in the free WhatsApp Business catalog (500 items, 10 images) — this builder makes the price list people forward.
            </p>
          </div>
        </div>
      </div>

      {/* The book and the pool: the shop's daily arithmetic, full width. */}
      <TheBook items={items.map((i) => ({ name: i.name, priceKes: i.priceKes }))} />
      <PoolACard items={items.map((i) => ({ name: i.name, priceKes: i.priceKes }))} />
    </div>
  );
}

export default WhatsAppShopBuilder;
