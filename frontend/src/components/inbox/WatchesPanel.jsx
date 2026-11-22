import { useCallback, useEffect, useState } from "react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";
import { apiError } from "@/lib/api";
import { ledgerAPI } from "@/lib/ledgerApi";
import { TEMPLATE_LABELS } from "@/lib/inference";

/**
 * NEIGHBOURHOOD WATCHES — the one setting that decides what you are told about.
 *
 * This lived on `pages/activity/ActivityPage`, which nothing in the navigation
 * opened: the Inbox tab went to a different screen, and the only doors to
 * Activity were old deep links. Consolidating the two inboxes had to move this
 * with it, because a watch is the thing that *makes* notifications arrive — it
 * belongs next to the list it feeds, not on a page nobody lands on.
 *
 * Kept as its own component rather than inlined: it owns form state and three
 * round trips, and none of that belongs in the file that also renders the feed.
 */

const WATCH_TYPE_OPTIONS = [
  { value: "", label: "Any posting type" },
  { value: "available", label: "Available (offers, produce, tools)" },
  { value: "wanted", label: "Wanted (repairs, help, group buys)" },
  { value: "scheduled", label: "Scheduled (artisan rounds, sessions)" },
  { value: "opportunity", label: "Opportunity (tasks, youth opportunities)" },
];

const WATCH_TEMPLATE_OPTIONS = [
  { value: "", label: "Any category" },
  ...Object.entries(TEMPLATE_LABELS).map(([value, label]) => ({ value, label })),
];

export default function WatchesPanel() {
  const [watches, setWatches] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    posting_type: "wanted",
    inferred_template: "repair_artisan",
    keyword: "",
    area_name: "",
    radius_km: "15",
  });

  const load = useCallback(async () => {
    try {
      const res = await ledgerAPI.listWatches();
      setWatches(res?.data?.items || []);
    } catch {
      // A watch list is optional: a failure here must never blank the Inbox.
      setWatches([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onAdd = async (e) => {
    e.preventDefault();
    try {
      await ledgerAPI.createWatch({
        posting_type: form.posting_type || null,
        inferred_template: form.inferred_template || null,
        keyword: form.keyword.trim() || null,
        area_name: form.area_name.trim() || null,
        radius_km: Number(form.radius_km) || 15,
      });
      toast.success("Neighbourhood watch saved");
      setOpen(false);
      setForm((f) => ({ ...f, keyword: "" }));
      await load();
    } catch (err) {
      toast.error(apiError(err, "Could not save that watch"));
    }
  };

  const onDelete = async (watchId) => {
    try {
      await ledgerAPI.deleteWatch(watchId);
      setWatches((prev) => prev.filter((w) => w.id !== watchId));
      toast.success("Watch removed");
    } catch (err) {
      toast.error(apiError(err, "Could not remove watch"));
    }
  };

  return (
    <section
      data-testid="activity-watches-panel"
      className="mt-5 rounded-2xl border border-edge-1 bg-surface-1 p-3 shadow-xs"
      aria-labelledby="inbox-watches"
    >
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
          <Sparkles size={15} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="inbox-watches" className="text-sm font-bold leading-tight text-ink-1">
            Neighbourhood watches
          </h2>
          <p className="mt-0.5 text-2xs leading-snug text-ink-3">
            Alerts for local needs, artisans and produce.
          </p>
        </div>
        <Button
          size="xs"
          variant="secondary"
          icon={open ? undefined : Plus}
          onClick={() => setOpen((v) => !v)}
          data-testid="toggle-add-watch-btn"
          className="shrink-0"
        >
          {open ? "Close" : "Add"}
        </Button>
      </div>

      {open && (
        <form
          onSubmit={onAdd}
          className="mt-3 grid gap-2.5 rounded-xl border border-edge-1 bg-surface-0 p-3 sm:grid-cols-2"
        >
          <Select
            label="Posting type"
            options={WATCH_TYPE_OPTIONS}
            value={form.posting_type}
            onChange={(e) => setForm((f) => ({ ...f, posting_type: e.target.value }))}
          />
          <Select
            label="Category / template"
            options={WATCH_TEMPLATE_OPTIONS}
            value={form.inferred_template}
            onChange={(e) => setForm((f) => ({ ...f, inferred_template: e.target.value }))}
          />
          <Input
            label="Keyword (optional)"
            value={form.keyword}
            onChange={(e) => setForm((f) => ({ ...f, keyword: e.target.value }))}
            placeholder="e.g. fence, cobbler, napier"
            data-testid="watch-keyword-input"
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              label="Area"
              value={form.area_name}
              onChange={(e) => setForm((f) => ({ ...f, area_name: e.target.value }))}
              placeholder="Kisii, Muthaiga…"
            />
            <Input
              label="Radius (km)"
              type="number"
              min={1}
              max={200}
              value={form.radius_km}
              onChange={(e) => setForm((f) => ({ ...f, radius_km: e.target.value }))}
            />
          </div>
          <div className="flex justify-end sm:col-span-2">
            <Button size="sm" type="submit" data-testid="save-watch-btn">
              Save watch preference
            </Button>
          </div>
        </form>
      )}

      {watches.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {watches.map((w) => (
            <li
              key={w.id}
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-edge-1 bg-surface-0 px-2.5 py-1 text-2xs text-ink-2"
            >
              <span className="truncate">
                {[
                  w.posting_type || "any",
                  w.inferred_template ? TEMPLATE_LABELS[w.inferred_template] || w.inferred_template : null,
                  w.keyword ? `“${w.keyword}”` : null,
                  w.area_name || `${w.radius_km} km`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <button
                type="button"
                aria-label="Remove watch"
                onClick={() => onDelete(w.id)}
                className="shrink-0 text-ink-4 hover:text-danger"
              >
                <Trash2 size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
