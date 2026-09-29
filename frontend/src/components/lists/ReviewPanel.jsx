import { useEffect, useState } from "react";
import { Check, Pencil, Star, ThumbsUp, Trash2 } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Drawer from "@/components/ui/Drawer";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Avatar from "@/components/ui/Avatar";
import Tabs from "@/components/ui/Tabs";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { listAPI, apiError } from "@/lib/api";
import { useListStore } from "@/stores/listStore";
import { relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const SORTS = [
  { value: "recent", label: "Recent" },
  { value: "rating", label: "Highest" },
  { value: "helpful", label: "Most helpful" },
];

export function Stars({ value = 0, size = 12, className }) {
  const filled = Math.round(value || 0);
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} title={`${Number(value || 0).toFixed(1)} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} className={n <= filled ? "text-amber-400 fill-amber-400" : "text-ink-4/50"} />
      ))}
    </span>
  );
}

const emptyForm = { rating: 5, title: "", body: "" };

/**
 * Vendor-list reviews (v2.1 §4.2) — the reputation the members write. Only
 * approved members may review, one review each; the panel owns read + write,
 * and mirrors the new aggregate back into the list store so cards stay fresh.
 */
export default function ReviewsDrawer({ list, onClose }) {
  const patch = useListStore((s) => s.patch);
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [sort, setSort] = useState("recent");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async (id, nextSort = sort) => {
    setLoading(true);
    try {
      const res = await listAPI.reviews(id, { sort: nextSort, limit: 50 });
      setData(res.data);
      return res.data;
    } catch (e) {
      toast.error(apiError(e, "Couldn't load reviews"));
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setData(null);
    setForm(emptyForm);
    setWriting(false);
    setSort("recent");
    if (list) load(list.id, "recent");
  }, [list?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!list) return null;

  const mine = data?.reviews.find((r) => r.mine);

  const afterWrite = (res) => {
    patch(list.id, { avg_rating: res.avg_rating, review_count: res.review_count });
    load(list.id);
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = mine
        ? await listAPI.updateReview(list.id, form)
        : await listAPI.createReview(list.id, form);
      toast.success(res.data?.message || "Review saved");
      setWriting(false);
      setForm(emptyForm);
      afterWrite(res.data);
    } catch (err) {
      toast.error(apiError(err, "Couldn't save your review"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: "Delete your review?", message: "Your rating stops counting toward the list's average.", confirmLabel: "Delete" }))) return;
    try {
      const res = await listAPI.deleteReview(list.id);
      toast.success(res.data?.message || "Review removed");
      setForm(emptyForm);
      afterWrite(res.data);
    } catch (err) {
      toast.error(apiError(err, "Couldn't delete your review"));
    }
  };

  const helpful = async (review) => {
    try {
      const res = await listAPI.markHelpful(list.id, review.id);
      setData((d) => ({
        ...d,
        reviews: d.reviews.map((r) => (r.id === review.id ? { ...r, helpful_count: res.data.helpful_count, marked_helpful: true } : r)),
      }));
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const startWriting = () => {
    setForm(mine ? { rating: mine.rating, title: mine.title || "", body: mine.body || "" } : emptyForm);
    setWriting(true);
  };

  const distribution = data?.distribution || {};
  const maxBar = Math.max(1, ...Object.values(distribution));

  return (
    <Drawer
      open={!!list}
      onClose={onClose}
      title={list.name}
      description={data ? `${data.review_count} review${data.review_count === 1 ? "" : "s"} by members` : "member reviews"}
    >
      {loading && !data ? (
        <PageSpinner />
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-4 rounded-xl border border-edge-1 bg-surface-2 px-4 py-3">
            <div className="text-center">
              <p className="text-3xl font-semibold font-mono text-ink-1 leading-none">{Number(data?.avg_rating || 0).toFixed(1)}</p>
              <Stars value={data?.avg_rating} size={11} className="mt-1.5" />
            </div>
            <div className="flex-1 space-y-1">
              {[5, 4, 3, 2, 1].map((star) => (
                <div key={star} className="flex items-center gap-2">
                  <span className="text-2xs text-ink-4 font-mono w-3">{star}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                    <div className="h-full rounded-full bg-amber-400/80" style={{ width: `${(100 * (distribution[String(star)] || 0)) / maxBar}%` }} />
                  </div>
                  <span className="text-2xs text-ink-4 font-mono w-4 text-right">{distribution[String(star)] || 0}</span>
                </div>
              ))}
            </div>
          </div>

          {data?.can_review && !writing && (
            <Button size="sm" icon={Pencil} onClick={startWriting}>
              Write a review
            </Button>
          )}
          {!data?.can_review && !mine && !writing && (
            <p className="text-xs text-ink-4 rounded-lg border border-dashed border-edge-2 px-3 py-2">
              {data?.my_status === "approved"
                ? "You've already reviewed this list — edit your review below."
                : "Only vendors approved onto the list can review it. Register, then tell the network how it went."}
            </p>
          )}

          {writing && (
            <form onSubmit={submit} className="space-y-3 rounded-xl border border-edge-1 bg-surface-1 p-3">
              <div>
                <p className="text-2xs uppercase tracking-wider text-ink-4 mb-1.5">Your rating</p>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-label={`${n} star${n === 1 ? "" : "s"}`}
                      onClick={() => setForm({ ...form, rating: n })}
                      className="p-0.5"
                    >
                      <Star size={20} className={n <= form.rating ? "text-amber-400 fill-amber-400" : "text-ink-4/50"} />
                    </button>
                  ))}
                </div>
              </div>
              <Input label="Title" value={form.title} maxLength={160} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Was the list worth joining?" />
              <Textarea label="Review" rows={4} value={form.body} maxLength={4000} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="What did the patron vet for? How did the market day go?" />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" type="button" onClick={() => setWriting(false)}>
                  Cancel
                </Button>
                <Button size="sm" type="submit" loading={busy} icon={Check}>
                  {mine ? "Update review" : "Post review"}
                </Button>
              </div>
            </form>
          )}

          <Tabs tabs={SORTS} value={sort} size="sm" onChange={(v) => { setSort(v); load(list.id, v); }} />

          <div className="space-y-2">
            {(!data?.reviews || data.reviews.length === 0) && (
              <p className="text-xs text-ink-4 text-center py-6">No reviews yet — be the first member to write one.</p>
            )}
            {data?.reviews.map((r) => (
              <div key={r.id} className={cn("rounded-xl border p-3 space-y-2", r.mine ? "border-brand-800/60 bg-brand-950/20" : "border-edge-1 bg-surface-1")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar name={r.reviewer.business_name} size="xs" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-ink-1 truncate">
                        {r.reviewer.business_name} {r.mine && <span className="text-2xs text-brand-400">· you</span>}
                      </p>
                      <p className="text-2xs text-ink-4 font-mono truncate">@{r.reviewer.vendor_handle}{r.reviewer.is_patron ? " · patron" : ""}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <Stars value={r.rating} size={11} />
                    <p className="text-2xs text-ink-4 mt-0.5">{relativeTime(r.created_at)}</p>
                  </div>
                </div>
                {r.title && <p className="text-sm font-medium text-ink-1">{r.title}</p>}
                {r.body && <p className="text-xs text-ink-3 leading-relaxed whitespace-pre-line">{r.body}</p>}
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    {r.verified_member && (
                      <Badge variant="brand" size="xs">
                        <Check size={9} /> member
                      </Badge>
                    )}
                    {r.updated_at && <span className="text-2xs text-ink-4">edited</span>}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {r.mine ? (
                      <>
                        <Button size="xs" variant="ghost" icon={Pencil} onClick={startWriting} aria-label="Edit your review" />
                        <Button size="xs" variant="ghost" icon={Trash2} onClick={remove} aria-label="Delete your review" />
                      </>
                    ) : (
                      <Button
                        size="xs"
                        variant={r.marked_helpful ? "secondary" : "ghost"}
                        icon={ThumbsUp}
                        disabled={r.marked_helpful}
                        onClick={() => helpful(r)}
                      >
                        {r.helpful_count > 0 ? r.helpful_count : ""} helpful
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Drawer>
  );
}
