import { useEffect, useRef, useState } from "react";
import { ImagePlus, Layers, Plus, Trash2 } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Modal from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toast";
import { readGalleryPhoto } from "@/lib/images";
import { apiError } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Mirrors MAX_WORK_ITEMS in `app/services/work_showcase.py`. */
const MAX_VISIBLE_WORK = 12;

/**
 * SELECTED WORK — proof of work, on the shelf where the buyer already stands.
 * ---------------------------------------------------------------------------
 * This replaces a 1,700-line creative-portfolio page that had its own sticky
 * navigation, hero, discipline filters, editorial case-study theatre, price
 * list, project-inquiry form and studio dashboard. Almost none of that was a
 * capability the app provides; it was a website inside the app.
 *
 * What was worth keeping is one thing: **a business can show what it has done,
 * and a buyer can check it before hiring.** So it lives here, on the shop front,
 * next to the shelf — because "can they do the work?" and "what do they sell?"
 * are the same question asked in two halves.
 *
 * Rules this component keeps:
 *   · A work item is a CARD, not a document: an image, a title, one line about
 *     the job, one line about the result. No case-study chapters, no gallery
 *     carousels, no process essays.
 *   · A visitor never sees an empty box. No work means no section.
 *   · The owner adds and removes inline, like the shop gallery, so keeping it
 *     current does not need a separate dashboard.
 *   · No prices here. What a service costs is the Business Desk's job — this is
 *     the only place in the app where the two were ever confused.
 */
export function SelectedWork({ items = [], own = false, onAdd, onRemove }) {
  // A visitor never sees an empty box: no work means no section, not a
  // placeholder. An owner sees one quiet line instead of a whole empty card,
  // because most shops on the network sell goods and have no work to show.
  if (!items.length && !own) return null;

  if (!items.length) {
    return (
      <section
        aria-labelledby="selected-work-empty-heading"
        data-testid="selected-work-empty"
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-edge-2 bg-surface-0 px-4 py-3"
      >
        <div className="min-w-0">
          <p id="selected-work-empty-heading" className="text-sm font-semibold text-ink-1">
            Selected work
          </p>
          <p className="text-2xs text-ink-3">
            Take on jobs or commissions? Add one card each — buyers check this before they hire.
          </p>
        </div>
        <Button size="sm" variant="secondary" icon={Plus} onClick={onAdd}>
          Add work
        </Button>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="selected-work-heading"
      className="rounded-3xl border border-edge-1 bg-surface-0 p-5 space-y-3"
      data-testid="selected-work"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="selected-work-heading" className="text-base font-bold text-ink-1">
            Selected work
          </h2>
          <p className="text-2xs text-ink-3">
            {own
              ? "What you have delivered, in one card each. A photo is optional, the result is not."
              : "What this business has delivered, in their own words."}
          </p>
        </div>
        {own && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" size="xs">
              {items.length} / {MAX_VISIBLE_WORK}
            </Badge>
            <Button
              size="sm"
              variant="secondary"
              icon={Plus}
              onClick={onAdd}
              disabled={items.length >= MAX_VISIBLE_WORK}
            >
              {items.length >= MAX_VISIBLE_WORK ? "Showcase full" : "Add work"}
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="selected-work-grid">
        {items.map((item, idx) => (
          <WorkCard
            key={`${item.title}-${idx}`}
            item={item}
            own={own}
            onRemove={() => onRemove?.(idx)}
          />
        ))}
      </div>
    </section>
  );
}

function WorkCard({ item, own, onRemove }) {
  const initials = (item.discipline || "Work").slice(0, 2).toUpperCase();
  return (
    <article
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-edge-1 bg-surface-1"
      data-testid="selected-work-card"
    >
      {item.image_url ? (
        <img
          src={item.image_url}
          alt={item.title}
          loading="lazy"
          className="aspect-[4/3] w-full object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className="aspect-[4/3] w-full grid place-items-center bg-surface-2 text-ink-4"
        >
          <span className="flex items-center gap-1.5 text-micro font-bold uppercase tracking-[0.14em]">
            <Layers size={14} /> {initials}
          </span>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-1.5 p-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {item.discipline && (
            <Badge variant="brand" size="xs">
              {item.discipline}
            </Badge>
          )}
          {item.year && <span className="text-micro text-ink-4">{item.year}</span>}
        </div>
        <h3 className="text-sm font-bold text-ink-1 leading-snug">{item.title}</h3>
        {item.summary && (
          <p className="text-2xs text-ink-3 line-clamp-3">{item.summary}</p>
        )}
        {item.outcome && (
          <p className="mt-auto pt-1 text-2xs font-semibold text-brand-700 dark:text-brand-300">
            {item.outcome}
          </p>
        )}
      </div>

      {own && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${item.title}`}
          className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-lg bg-ink-1/80 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 cursor-pointer"
        >
          <Trash2 size={13} />
        </button>
      )}
    </article>
  );
}

/** Add one card. Six fields, four of them optional — the same rule as the API. */
export function AddWorkItemModal({ open, onClose, onSave }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(emptyForm());

  useEffect(() => {
    if (open) setForm(emptyForm());
  }, [open]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await readGalleryPhoto(file);
      setForm((f) => ({ ...f, image_url: url }));
    } catch (err) {
      toast.error(apiError(err, "Couldn't read that photo"));
    } finally {
      setUploading(false);
      if (e.target) e.target.value = "";
    }
  };

  const save = async () => {
    const title = form.title.trim();
    if (!title) {
      toast.error("Give the piece a title — that is what a buyer reads first.");
      return;
    }
    setBusy(true);
    try {
      await onSave({
        title,
        summary: form.summary.trim(),
        outcome: form.outcome.trim(),
        discipline: form.discipline.trim(),
        year: form.year.trim(),
        image_url: form.image_url,
      });
      onClose?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add selected work"
      description="One card per piece. What it was, and what came of it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={save}>
            Add to shop front
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-ink-2">Photo</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            aria-label="Choose a photo of the work"
            onChange={pickPhoto}
          />
          {form.image_url ? (
            <div className="relative overflow-hidden rounded-2xl border border-edge-1">
              <img src={form.image_url} alt="Selected work preview" className="aspect-[4/3] w-full object-cover" />
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, image_url: "" }))}
                aria-label="Remove photo"
                className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-lg bg-ink-1/80 text-white cursor-pointer"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={cn(
                "w-full rounded-2xl border border-dashed border-edge-2 bg-surface-1 p-4 text-center transition-colors hover:bg-surface-2 cursor-pointer"
              )}
            >
              <ImagePlus size={20} className="mx-auto text-brand-700 dark:text-brand-300" aria-hidden="true" />
              <p className="mt-1.5 text-xs font-semibold text-ink-1">
                {uploading ? "Reading photo…" : "Add a photo from your device"}
              </p>
              <p className="text-micro text-ink-4">Optional — a job with a clear result reads fine without one.</p>
            </button>
          )}
        </div>

        <Input label="Title" required value={form.title} onChange={set("title")} placeholder="Kibo Botanicals — identity system" maxLength={120} />
        <Textarea label="What it was" rows={3} value={form.summary} onChange={set("summary")} maxLength={280} hint="Two lines. What you made and for whom." />
        <Input label="What came of it" value={form.outcome} onChange={set("outcome")} placeholder="Twelve label formats at launch" maxLength={160} hint="One line a buyer can repeat." />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Kind of work" value={form.discipline} onChange={set("discipline")} placeholder="Branding" maxLength={40} />
          <Input label="Year" value={form.year} onChange={set("year")} placeholder="2026" maxLength={9} />
        </div>
      </div>
    </Modal>
  );
}

function emptyForm() {
  return { title: "", summary: "", outcome: "", discipline: "", year: "", image_url: "" };
}
