import { useState } from "react";
import { X, Store, Users, Tag, MapPin, DollarSign, Package, Sparkles } from "lucide-react";
import { commercialAPI, apiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const POST_TYPES = [
  { value: "regular", label: "Regular post", desc: "Share news, tips, recommendations" },
  { value: "commercial", label: "Commercial offer", desc: "Post with price and savings" },
  { value: "group_buy", label: "Group buy", desc: "Coordinate bulk buying for better price" },
  { value: "deal", label: "Limited deal", desc: "Time-sensitive offer" },
  { value: "savings", label: "Savings alert", desc: "Highlight verified savings" },
];

export default function CreateCommercialPost({ open, onClose, onCreated, stockItems = [] }) {
  const [form, setForm] = useState({
    title: "",
    content: "",
    post_type: "regular",
    is_commercial: false,
    individual_price: "",
    group_price: "",
    target_quantity: "",
    min_group_size: "",
    category: "",
    location: "",
    tags: "",
    commission_rate: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const isCommercial = form.post_type !== "regular" || form.is_commercial || form.individual_price || form.group_price;
  const isGroupBuy = form.post_type === "group_buy";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        title: form.title || undefined,
        content: form.content,
        post_type: form.post_type,
        is_commercial: Boolean(isCommercial),
        individual_price: form.individual_price ? Number(form.individual_price) : undefined,
        group_price: form.group_price ? Number(form.group_price) : undefined,
        target_quantity: form.target_quantity ? Number(form.target_quantity) : undefined,
        min_group_size: form.min_group_size ? Number(form.min_group_size) : undefined,
        category: form.category || undefined,
        location: form.location || undefined,
        tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        commission_rate: form.commission_rate ? Number(form.commission_rate) : undefined,
      };
      const res = await commercialAPI.create(payload);
      onCreated?.(res.data);
      setForm({
        title: "", content: "", post_type: "regular", is_commercial: false,
        individual_price: "", group_price: "", target_quantity: "", min_group_size: "",
        category: "", location: "", tags: "", commission_rate: "",
      });
      onClose();
    } catch (err) {
      setError(apiError(err, "Could not create post"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-surface-0 border border-edge-1 shadow-2xl animate-slide-up">
        <div className="sticky top-0 bg-surface-0 border-b border-edge-1 p-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-ink-1 flex items-center gap-2">
              <Store size={16} className="text-brand-600" /> New post
            </h3>
            <p className="text-2xs text-ink-4">Share an update or a commercial offer</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl hover:bg-surface-2 text-ink-4">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Type */}
          <div>
            <label className="text-2xs font-bold text-ink-2 uppercase tracking-wide">Post type</label>
            <div className="mt-2 grid grid-cols-1 gap-2">
              {POST_TYPES.map((t) => (
                <label key={t.value} className={cn("flex items-start gap-2.5 rounded-xl border p-3 cursor-pointer transition-colors", form.post_type === t.value ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-edge-1 hover:border-edge-2")}>
                  <input type="radio" name="post_type" value={t.value} checked={form.post_type === t.value} onChange={(e) => setForm({ ...form, post_type: e.target.value })} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-ink-1">{t.label}</p>
                    <p className="text-2xs text-ink-4">{t.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="text-2xs font-bold text-ink-2 uppercase tracking-wide">Title (optional)</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. 20 laptops for schools — group order welcome" className="mt-1 w-full rounded-xl border border-edge-1 bg-surface-1 px-3 py-2.5 text-sm text-ink-1 placeholder:text-ink-4 focus:border-brand-500 focus:outline-none" />
          </div>

          <div>
            <label className="text-2xs font-bold text-ink-2 uppercase tracking-wide">Content *</label>
            <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required rows={4} placeholder="What do you want to share? For commercial posts, include product details, availability, and why it's a good deal..." className="mt-1 w-full rounded-xl border border-edge-1 bg-surface-1 px-3 py-2.5 text-sm text-ink-1 placeholder:text-ink-4 focus:border-brand-500 focus:outline-none resize-none" />
          </div>

          {/* Commercial shelf */}
          {(isCommercial || form.post_type !== "regular") && (
            <div className="rounded-2xl border border-emerald-200/50 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/5 p-3 space-y-3">
              <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                <DollarSign size={14} /> Commercial shelf — pricing
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-2xs text-ink-4">Individual price (KES)</label>
                  <input type="number" min="0" step="0.01" value={form.individual_price} onChange={(e) => setForm({ ...form, individual_price: e.target.value })} placeholder="55000" className="mt-1 w-full rounded-xl border border-edge-1 bg-surface-0 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-2xs text-ink-4">Group price (KES)</label>
                  <input type="number" min="0" step="0.01" value={form.group_price} onChange={(e) => setForm({ ...form, group_price: e.target.value })} placeholder="49000" className="mt-1 w-full rounded-xl border border-edge-1 bg-surface-0 px-3 py-2 text-sm" />
                </div>
              </div>
              {form.individual_price && form.group_price && Number(form.individual_price) > Number(form.group_price) && (
                <p className="text-2xs font-medium text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                  <Sparkles size={12} /> Saves KES {Number(form.individual_price) - Number(form.group_price)} per unit · {Math.round(((Number(form.individual_price) - Number(form.group_price)) / Number(form.individual_price)) * 100)}% less
                </p>
              )}
            </div>
          )}

          {/* Group-buying layer */}
          {isGroupBuy && (
            <div className="rounded-2xl border border-blue-200/50 dark:border-blue-500/20 bg-blue-50/50 dark:bg-blue-500/5 p-3 space-y-3">
              <p className="text-xs font-bold text-blue-800 dark:text-blue-300 flex items-center gap-1.5">
                <Users size={14} /> Group-buying layer
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-2xs text-ink-4">Target quantity</label>
                  <input type="number" min="1" value={form.target_quantity} onChange={(e) => setForm({ ...form, target_quantity: e.target.value })} placeholder="20" className="mt-1 w-full rounded-xl border border-edge-1 bg-surface-0 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-2xs text-ink-4">Min group size</label>
                  <input type="number" min="1" value={form.min_group_size} onChange={(e) => setForm({ ...form, min_group_size: e.target.value })} placeholder="5 buyers" className="mt-1 w-full rounded-xl border border-edge-1 bg-surface-0 px-3 py-2 text-sm" />
                </div>
              </div>
            </div>
          )}

          {/* Salesperson distribution */}
          {isCommercial && (
            <div>
              <label className="text-2xs font-bold text-ink-2 uppercase tracking-wide flex items-center gap-1">
                <Users size={12} /> Commission for sharers (moat: distribution)
              </label>
              <input type="number" min="0" max="100" step="0.1" value={form.commission_rate} onChange={(e) => setForm({ ...form, commission_rate: e.target.value })} placeholder="5% commission for salespeople who bring buyers" className="mt-1 w-full rounded-xl border border-edge-1 bg-surface-1 px-3 py-2.5 text-sm" />
              <p className="text-2xs text-ink-4 mt-1">Salespeople share your offer and earn when they generate sales. This builds your distribution network.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-2xs text-ink-4 flex items-center gap-1"><Package size={12} /> Category</label>
              <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="electronics, groceries..." className="mt-1 w-full rounded-xl border border-edge-1 bg-surface-1 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-2xs text-ink-4 flex items-center gap-1"><MapPin size={12} /> Location</label>
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Kisumu, Nairobi..." className="mt-1 w-full rounded-xl border border-edge-1 bg-surface-1 px-3 py-2 text-sm" />
            </div>
          </div>

          <div>
            <label className="text-2xs text-ink-4 flex items-center gap-1"><Tag size={12} /> Tags (comma separated)</label>
            <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="laptops, schools, bulk" className="mt-1 w-full rounded-xl border border-edge-1 bg-surface-1 px-3 py-2 text-sm" />
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl p-2.5">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 h-11 rounded-xl border border-edge-1 bg-surface-1 text-sm font-semibold text-ink-2">Cancel</button>
            <button type="submit" disabled={saving || !form.content.trim()} className="flex-1 h-11 rounded-xl bg-brand-600 text-white text-sm font-bold disabled:opacity-50 hover:bg-brand-700">
              {saving ? "Posting…" : isGroupBuy ? "Post group buy" : isCommercial ? "Post offer" : "Post"}
            </button>
          </div>

          <p className="text-2xs text-ink-4 text-center">
            Harnessing existing stock, collective buying, and vendor groups — not replacing them.
          </p>
        </form>
      </div>
    </div>
  );
}
