import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, CalendarDays, Check, Eye, ImageIcon, MapPin, Save, Send, Trash2, X,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import Chip from "@/components/ui/Chip";
import { toast } from "@/components/ui/Toast";
import { CREATE_TYPES } from "@/config/navigation";
import {
  FIELD_OPTIONS, TYPE_FIELDS, fieldsFor, hasContent, missingFields, useCreateStore,
} from "@/stores/createStore";
import { useOutsideStore, locationLabel } from "@/stores/outsideStore";
import { fileAPI, outsideAPI } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * CREATE — one page, six content types, no per-shelf onboarding.
 *
 * This is the screen that replaces "learn how each module publishes". The
 * contract with the person using it:
 *
 *   1. pick what you are making;
 *   2. see only the fields that thing actually needs;
 *   3. switch type at any point without losing what you typed;
 *   4. everything is saved as you go, so a failure costs nothing;
 *   5. price is a field you *may* fill in, never one you must.
 *
 * Progressive disclosure is driven by `TYPE_FIELDS`, which mirrors
 * `publish.REQUIRED_FIELDS` on the server — the client and the API refuse the
 * same submission for the same reason.
 */
export default function CreatePage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const draft = useCreateStore((s) => s.draft);
  const setType = useCreateStore((s) => s.setType);
  const setField = useCreateStore((s) => s.setField);
  const addMedia = useCreateStore((s) => s.addMedia);
  const removeMedia = useCreateStore((s) => s.removeMedia);
  const publish = useCreateStore((s) => s.publish);
  const discard = useCreateStore((s) => s.discard);
  const submitting = useCreateStore((s) => s.submitting);
  const error = useCreateStore((s) => s.error);
  const hasDraft = useCreateStore((s) => s.hasDraft);

  const location = useOutsideStore((s) => s.location);
  const loadLocation = useOutsideStore((s) => s.loadLocation);

  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showAllFields, setShowAllFields] = useState(false);
  const fileRef = useRef(null);

  const type = TYPE_FIELDS[draft.content_type] || TYPE_FIELDS.post;
  const shown = fieldsFor(draft.content_type);
  const missing = missingFields(draft);

  // A deep link (`/create?type=event`) selects the type without a second click.
  useEffect(() => {
    const wanted = params.get("type");
    if (wanted && TYPE_FIELDS[wanted] && wanted !== draft.content_type) setType(wanted);
    if (!location) loadLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const onPickType = useCallback((value) => {
    setType(value);
    const next = new URLSearchParams(params);
    next.set("type", value);
    setParams(next, { replace: true });
  }, [params, setParams, setType]);

  /**
   * Upload failure is a first-class state, not an exception. A failed upload
   * says so, keeps the text you wrote, and leaves the form publishable —
   * losing a post because an image didn't go is the wrong trade.
   */
  const onFiles = useCallback(async (files) => {
    const list = Array.from(files || []).slice(0, 4);
    if (!list.length) return;
    setUploading(true);
    let failed = 0;
    for (const file of list) {
      try {
        const { data } = await fileAPI.upload(file);
        const ref = data?.url || data?.path || data?.file_url;
        if (ref) addMedia(ref);
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    setUploading(false);
    if (failed) {
      toast.error(`${failed} image${failed > 1 ? "s" : ""} didn't upload. Your text is safe — you can publish without ${failed > 1 ? "them" : "it"}.`);
    } else if (list.length) {
      toast.success("Image added");
    }
  }, [addMedia]);

  const onPublish = useCallback(async () => {
    const outcome = await publish(async (payload) => {
      const { data } = await outsideAPI.create(payload);
      return data;
    });
    if (!outcome.ok) {
      if (outcome.missing?.length) {
        toast.error(`Add ${outcome.missing.join(" and ")} to publish this.`);
      }
      return;
    }
    toast.success(`Your ${draft.content_type} is live.`);
    const to = outcome.result?.to;
    if (to) navigate(to);
    else navigate("/");
  }, [draft.content_type, navigate, publish]);

  const fields = useMemo(() => {
    const spec = type.fields || [];
    // Progressive disclosure: the required fields and the shared essentials
    // show immediately; the long tail sits behind "More options".
    const essential = new Set([...(type.required || []), "title", "body", "location", "media"]);
    return {
      primary: ["title", "body", "media", "location", ...spec.filter((f) => essential.has(f) || (type.required || []).includes(f))],
      secondary: shown.filter((f) => !essential.has(f) && !(type.required || []).includes(f)),
    };
  }, [type, shown]);

  const visiblePrimary = dedupe(fields.primary);
  const visibleSecondary = dedupe(fields.secondary);

  return (
    <div className="mx-auto max-w-2xl space-y-s5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-micro font-bold uppercase tracking-[0.14em] text-ink-4">Create</p>
          <h1 className="mt-1 text-title-page font-bold text-ink-1">What are you making?</h1>
          <p className="mt-1.5 text-sm text-ink-3">
            One place for everything you publish. Pick a type and you'll only see the fields it needs.
          </p>
        </div>
        {hasDraft() && (
          <Button size="sm" variant="ghost" icon={Trash2} onClick={discard}>
            Clear
          </Button>
        )}
      </header>

      {/* ── 1. content type ─────────────────────────────────────────────── */}
      <section aria-labelledby="create-type-heading" className="space-y-3">
        <h2 id="create-type-heading" className="text-title-section font-semibold text-ink-1">
          Content type
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Content type">
          {CREATE_TYPES.map((option) => {
            const Icon = option.icon;
            const active = draft.content_type === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onPickType(option.value)}
                data-testid={`create-type-${option.value}`}
                className={cn(
                  "flex min-h-tap flex-col items-start gap-1.5 rounded-card border p-3 text-left transition-colors",
                  active
                    ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                    : "border-edge-1 bg-surface-1 hover:border-edge-2 hover:bg-surface-2",
                )}
              >
                <span className={cn(
                  "grid h-8 w-8 place-items-center rounded-xl",
                  active ? "bg-brand-500 text-white" : "bg-surface-2 text-ink-3",
                )}>
                  <Icon size={16} aria-hidden="true" />
                </span>
                <span className="text-sm font-semibold text-ink-1">{option.label}</span>
                <span className="text-2xs leading-snug text-ink-4">{option.hint}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── 2. the fields this type actually needs ──────────────────────── */}
      <section aria-labelledby="create-fields-heading" className="space-y-4 rounded-card-lg border border-edge-1 bg-surface-1 p-4 shadow-xs sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="create-fields-heading" className="text-title-section font-semibold text-ink-1">
              Details
            </h2>
            <p className="mt-0.5 text-2xs text-ink-4">
              Only what a {draft.content_type} needs. Price is optional — leave it out and it simply isn't a sale.
            </p>
          </div>
          <Button size="xs" variant="ghost" icon={Eye} onClick={() => setPreview((v) => !v)}>
            {preview ? "Hide preview" : "Preview"}
          </Button>
        </div>

        {visiblePrimary.map((field) => (
          <Field
            key={field}
            field={field}
            draft={draft}
            setField={setField}
            bodyLabel={type.bodyLabel}
            bodyPlaceholder={type.bodyPlaceholder}
            locationLabel={locationLabel(location)}
            fileRef={fileRef}
            onFiles={onFiles}
            uploading={uploading}
            removeMedia={removeMedia}
          />
        ))}

        {visibleSecondary.length > 0 && (
          <div className="space-y-4 border-t border-edge-1 pt-4">
            <button
              type="button"
              onClick={() => setShowAllFields((v) => !v)}
              aria-expanded={showAllFields}
              className="text-xs font-semibold text-brand-700 hover:text-brand-800 dark:text-brand-300"
            >
              {showAllFields ? "Fewer options" : `More options (${visibleSecondary.length})`}
            </button>
            {showAllFields && visibleSecondary.map((field) => (
              <Field
                key={field}
                field={field}
                draft={draft}
                setField={setField}
                bodyLabel={type.bodyLabel}
                bodyPlaceholder={type.bodyPlaceholder}
                locationLabel={locationLabel(location)}
                fileRef={fileRef}
                onFiles={onFiles}
                uploading={uploading}
                removeMedia={removeMedia}
              />
            ))}
          </div>
        )}

        {preview && <Preview draft={draft} />}
      </section>

      {/* ── 3. publish ──────────────────────────────────────────────────── */}
      <div className="space-y-2">
        {error && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
            {error}
          </p>
        )}
        <p className="flex items-center gap-1.5 text-2xs text-ink-4">
          <Save size={12} aria-hidden="true" />
          Saved as you type. Close the tab and it's still here.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="lg" icon={Send} onClick={onPublish} loading={submitting} disabled={missing.length > 0}>
            {submitting ? "Publishing…" : `Publish ${draft.content_type}`}
          </Button>
          <Button size="lg" variant="secondary" onClick={() => navigate(-1)} icon={ArrowLeft}>
            Not now
          </Button>
          {missing.length > 0 && (
            <span className="text-2xs text-ink-4">
              Needs: {missing.join(", ")}
            </span>
          )}
        </div>
        <Link to="/explore" className="inline-block text-2xs text-ink-4 underline-offset-2 hover:underline">
          Or go and see what's already around you
        </Link>
      </div>
    </div>
  );
}

function dedupe(list) {
  return [...new Set(list)];
}

/* ── one field ─────────────────────────────────────────────────────────────── */

function Field({ field, draft, setField, bodyLabel, bodyPlaceholder, locationLabel: locLabel,
                fileRef, onFiles, uploading, removeMedia }) {
  const required = (TYPE_FIELDS[draft.content_type]?.required || []).includes(field);
  const options = FIELD_OPTIONS[field];

  switch (field) {
    case "title":
      return (
        <Input
          label="Title"
          required={required}
          value={draft.title}
          maxLength={200}
          onChange={(e) => setField("title", e.target.value)}
          placeholder={draft.content_type === "post" ? "Optional — a short headline" : "Give it a name people will recognise"}
          hint={required ? undefined : "Optional"}
          data-testid="create-title"
        />
      );

    case "body":
      return (
        <Textarea
          label={bodyLabel || "What's happening?"}
          required={required}
          rows={5}
          maxLength={8000}
          value={draft.body}
          onChange={(e) => setField("body", e.target.value)}
          placeholder={bodyPlaceholder}
          hint={draft.content_type === "post" ? "At least 8 characters." : undefined}
          data-testid="create-body"
        />
      );

    case "media":
      return (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-ink-2">Photos</p>
          <div className="flex flex-wrap items-center gap-2">
            {(draft.media || []).map((ref, index) => (
              <span key={`${ref}-${index}`} className="relative">
                <img
                  src={ref}
                  alt=""
                  loading="lazy"
                  className="h-20 w-20 rounded-card-sm border border-edge-1 object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeMedia(index)}
                  aria-label={`Remove image ${index + 1}`}
                  className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-surface-1 text-ink-3 shadow-sm hover:text-danger"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="grid h-20 w-20 place-items-center rounded-card-sm border border-dashed border-edge-2 text-ink-4 transition-colors hover:border-brand-500 hover:text-brand-700 disabled:opacity-50"
            >
              {uploading ? <span className="text-2xs">Uploading…</span> : <ImageIcon size={18} aria-hidden="true" />}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }}
            />
          </div>
          <p className="mt-1.5 text-2xs text-ink-4">
            Optional, up to four. If an upload fails your text is kept.
          </p>
        </div>
      );

    case "location":
      return (
        <Input
          label="Where"
          icon={MapPin}
          value={draft.location}
          maxLength={300}
          onChange={(e) => setField("location", e.target.value)}
          placeholder={locLabel || "A neighbourhood, a venue, or leave it out"}
          hint="An area is enough. Don't put a home address on something public."
          data-testid="create-location"
        />
      );

    case "tags":
      return (
        <Input
          label="Tags"
          value={draft.tags}
          onChange={(e) => setField("tags", e.target.value)}
          placeholder="comma, separated, words"
          hint="Optional. Helps people searching find this."
        />
      );

    case "category":
      return (
        <Input
          label="Category"
          value={draft.category}
          maxLength={100}
          onChange={(e) => setField("category", e.target.value)}
          placeholder="e.g. food, football, plumbing"
          hint="Optional — one word or a short phrase."
        />
      );

    case "starts_at":
    case "ends_at":
    case "expires_at": {
      const labels = {
        starts_at: draft.content_type === "event" ? "When does it start?" : "When does it happen?",
        ends_at: "When does it end?",
        expires_at: "Available until",
      };
      return (
        <Input
          label={labels[field]}
          type="datetime-local"
          required={required}
          value={draft[field]}
          onChange={(e) => setField(field, e.target.value)}
          hint={required ? undefined : "Optional — helps people see it at the right time."}
          data-testid={`create-${field}`}
        />
      );
    }

    case "capacity":
      return (
        <Input
          label={draft.content_type === "event" ? "How many people?" : "How many places?"}
          type="number"
          min={0}
          value={draft.capacity}
          onChange={(e) => setField("capacity", e.target.value)}
          placeholder="Leave empty for no limit"
          hint="Optional."
        />
      );

    case "quantity":
      return (
        <Input
          label="How many?"
          type="number"
          min={0}
          value={draft.quantity}
          onChange={(e) => setField("quantity", e.target.value)}
          placeholder="0"
          hint="Optional, but people like to know."
        />
      );

    case "min_order_quantity":
      return (
        <Input
          label="Minimum order"
          type="number"
          min={1}
          value={draft.min_order_quantity}
          onChange={(e) => setField("min_order_quantity", e.target.value)}
          placeholder="1"
        />
      );

    case "price_kes":
      return (
        <Input
          label="Price (KSh)"
          type="number"
          min={0}
          prefix="KSh"
          value={draft.price_kes}
          onChange={(e) => setField("price_kes", e.target.value)}
          placeholder="Leave empty — it isn't for sale"
          hint="Optional. Leaving this out is a normal choice, not an unfinished form."
          data-testid="create-price"
        />
      );

    case "wholesale_price_kes":
      return (
        <Input
          label="Bulk price (KSh)"
          type="number"
          min={0}
          prefix="KSh"
          value={draft.wholesale_price_kes}
          onChange={(e) => setField("wholesale_price_kes", e.target.value)}
          placeholder="Optional"
        />
      );

    case "is_virtual":
      return (
        <label className="flex min-h-tap cursor-pointer items-center gap-2.5 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={Boolean(draft.is_virtual)}
            onChange={(e) => setField("is_virtual", e.target.checked)}
            className="h-4 w-4 rounded border-edge-2 text-brand-600 focus:ring-brand-500"
          />
          This happens online
        </label>
      );

    case "virtual_link":
      return draft.is_virtual ? (
        <Input
          label="Link"
          type="url"
          value={draft.virtual_link}
          maxLength={500}
          onChange={(e) => setField("virtual_link", e.target.value)}
          placeholder="https://…"
        />
      ) : null;

    case "requires_approval":
      return (
        <label className="flex min-h-tap cursor-pointer items-center gap-2.5 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={Boolean(draft.requires_approval)}
            onChange={(e) => setField("requires_approval", e.target.checked)}
            className="h-4 w-4 rounded border-edge-2 text-brand-600 focus:ring-brand-500"
          />
          People need my approval to join
        </label>
      );

    default:
      if (options) {
        return (
          <Select
            label={labelFor(field)}
            options={options}
            value={draft[field] || ""}
            onChange={(e) => setField(field, e.target.value)}
            data-testid={`create-${field}`}
          />
        );
      }
      return null;
  }
}

function labelFor(field) {
  return {
    visibility: "Who can see this",
    audience: "Who is it for",
    response_kind: "What should people be able to do",
    post_type: "What kind of post",
    group_type: "What kind of community",
    request_type: "Is this a commercial request?",
    urgency: "When do you need it",
    unit: "Measured in",
  }[field] || field.replace(/_/g, " ");
}

/* ── the preview ───────────────────────────────────────────────────────────── */

function Preview({ draft }) {
  return (
    <div aria-label="Preview" className="rounded-card border border-edge-1 bg-surface-0 p-4">
      <p className="mb-2 flex items-center gap-1.5 text-micro font-bold uppercase tracking-[0.14em] text-ink-4">
        <Check size={12} aria-hidden="true" /> How it will look
      </p>
      <div className="rounded-card-sm border border-edge-1 bg-surface-1 p-3">
        {(draft.media || []).length > 0 && (
          <img src={draft.media[0]} alt="" className="mb-2 aspect-[4/3] w-full rounded-card-sm object-cover" />
        )}
        <div className="flex items-center gap-1.5">
          <Chip size="sm" active>{draft.content_type}</Chip>
          {draft.visibility !== "public" && <Chip size="sm">{draft.visibility}</Chip>}
          {draft.price_kes && <Chip size="sm">KSh {draft.price_kes}</Chip>}
        </div>
        {draft.title && <p className="mt-2 text-sm font-semibold text-ink-1">{draft.title}</p>}
        <p className="mt-1 whitespace-pre-line text-xs text-ink-2">
          {draft.body || <span className="text-ink-4">Nothing written yet.</span>}
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-4">
          {draft.location && <span className="inline-flex items-center gap-1"><MapPin size={11} aria-hidden="true" />{draft.location}</span>}
          {draft.starts_at && <span className="inline-flex items-center gap-1"><CalendarDays size={11} aria-hidden="true" />{draft.starts_at.replace("T", " ")}</span>}
        </p>
      </div>
      <p className="mt-2 text-2xs text-ink-4">
        {hasContent(draft)
          ? "This is what people will see. Nothing here says a price is required."
          : "Start typing and this fills in."}
      </p>
    </div>
  );
}
