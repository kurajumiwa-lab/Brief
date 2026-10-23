import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, CalendarDays, Check, Eye, ImageIcon, Lock, MapPin, Save, Send,
  ShieldCheck, Sparkles, Store, Trash2, X,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import Chip from "@/components/ui/Chip";
import Badge from "@/components/ui/Badge";
import { toast } from "@/components/ui/Toast";
import { CREATE_TYPES, PRIMARY_POSTING_TYPES } from "@/config/navigation";
import {
  FIELD_OPTIONS, LEDGER_PRIMARY_TYPES, TYPE_FIELDS, fieldsFor, hasContent,
  missingFields, useCreateStore,
} from "@/stores/createStore";
import { useOutsideStore, locationLabel } from "@/stores/outsideStore";
import { fileAPI, outsideAPI } from "@/lib/api";
import {
  YOUTH_AGE_BANDS, YOUTH_SAFE_DOMAINS, inferActivityTemplate,
} from "@/lib/inference";
import { cn } from "@/lib/utils";

/**
 * CREATE — Primary 4 Local Activity Ledger posting types (`Available`,
 * `Wanted`, `Scheduled`, `Opportunity`) with deterministic live category
 * inference, progressive template fields, and household privacy defaults,
 * while preserving all 6 classic Outside content types.
 */
export default function CreatePage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const draft = useCreateStore((s) => s.draft);
  const setType = useCreateStore((s) => s.setType);
  const setField = useCreateStore((s) => s.setField);
  const setTemplateField = useCreateStore((s) => s.setTemplateField);
  const setPermissionRule = useCreateStore((s) => s.setPermissionRule);
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

  const isLedgerMode = LEDGER_PRIMARY_TYPES.has(draft.content_type) || Boolean(draft.use_ledger);
  const type = TYPE_FIELDS[draft.content_type] || TYPE_FIELDS.post;
  const shown = fieldsFor(draft.content_type);
  const missing = missingFields(draft);

  const inference = useMemo(
    () =>
      inferActivityTemplate({
        posting_type: draft.content_type,
        title: draft.title,
        body: draft.body,
        category: draft.category,
      }),
    [draft.content_type, draft.title, draft.body, draft.category],
  );

  useEffect(() => {
    const wanted = params.get("type");
    const ledgerFlag = params.get("ledger") === "1";
    if (wanted && TYPE_FIELDS[wanted] && (wanted !== draft.content_type || (ledgerFlag && !draft.use_ledger))) {
      setType(wanted, {
        use_ledger: LEDGER_PRIMARY_TYPES.has(wanted) || ledgerFlag,
      });
    }
    if (!location) loadLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // Materialize the youth-safety defaults the UI displays, so what the
  // organizer sees selected is exactly what the server validates.
  useEffect(() => {
    if (!isLedgerMode || inference.inferred_template !== "supervised_youth_task") return;
    const tf = draft.template_fields || {};
    if (!tf.age_band) setTemplateField("age_band", "16_17_supervised");
    if (!tf.permitted_domain) setTemplateField("permitted_domain", "garden_help");
    if (!tf.schedule_window) setTemplateField("schedule_window", "school_holiday");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLedgerMode, inference.inferred_template]);

  const onPickPrimaryPostingType = useCallback((value) => {
    setType(value, { use_ledger: true });
    const next = new URLSearchParams(params);
    next.set("type", value);
    if (value === "opportunity") next.set("ledger", "1");
    else next.delete("ledger");
    setParams(next, { replace: true });
  }, [params, setParams, setType]);

  const onPickClassicType = useCallback((value) => {
    setType(value, { use_ledger: false });
    const next = new URLSearchParams(params);
    next.set("type", value);
    next.delete("ledger");
    setParams(next, { replace: true });
  }, [params, setParams, setType]);

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
    const activeType = draft.content_type;
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
    toast.success(`Your ${activeType} is live.`);
    const to = outcome.result?.to || (outcome.result?.record === "local_activity" && outcome.result?.id ? `/activities/${outcome.result.id}` : null);
    if (to) navigate(to);
    else navigate("/");
  }, [draft.content_type, navigate, publish]);

  const fields = useMemo(() => {
    const spec = type.fields || [];
    const essential = new Set([
      ...(type.required || []),
      "title",
      "body",
      "location",
      "media",
      ...(isLedgerMode ? ["private_directions", "schedule_label"] : []),
    ]);
    return {
      primary: [
        "title",
        "body",
        "media",
        "location",
        ...spec.filter((f) => essential.has(f) || (type.required || []).includes(f)),
      ],
      secondary: shown.filter((f) => !essential.has(f) && !(type.required || []).includes(f)),
    };
  }, [type, shown, isLedgerMode]);

  const visiblePrimary = dedupe(fields.primary);
  const visibleSecondary = dedupe(fields.secondary);

  return (
    <div className="mx-auto max-w-2xl space-y-s5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-micro font-bold uppercase tracking-[0.14em] text-ink-4">Create</p>
          <h1 className="mt-1 text-title-page font-bold text-ink-1">What are you posting?</h1>
          <p className="mt-1.5 text-sm text-ink-3">
            Start with one of the four neighbourhood activity types — or pick a classic format below. No business profile or price required.
          </p>
        </div>
        {hasDraft() && (
          <Button size="sm" variant="ghost" icon={Trash2} onClick={discard}>
            Clear
          </Button>
        )}
      </header>

      {/* ── 1A. Primary 4 Local Activity Ledger posting types ───────────── */}
      <section aria-labelledby="primary-posting-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="primary-posting-heading" className="text-title-section font-semibold text-ink-1">
            Primary neighbourhood activities
          </h2>
          <Badge variant="brand" size="sm">Local Activity Ledger</Badge>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="radiogroup" aria-label="Primary posting type">
          {PRIMARY_POSTING_TYPES.map((option) => {
            const Icon = option.icon;
            const active =
              draft.content_type === option.value &&
              (option.value !== "opportunity" || Boolean(draft.use_ledger));
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onPickPrimaryPostingType(option.value)}
                data-testid={`posting-type-${option.value}`}
                className={cn(
                  "flex min-h-tap flex-col items-start gap-1.5 rounded-card border p-3 text-left transition-colors",
                  active
                    ? "border-brand-500 bg-brand-50 dark:bg-brand-500/15"
                    : "border-edge-1 bg-surface-1 hover:border-edge-2 hover:bg-surface-2",
                )}
              >
                <span
                  className={cn(
                    "grid h-8 w-8 place-items-center rounded-xl",
                    active ? "bg-brand-500 text-white" : "bg-surface-2 text-ink-3",
                  )}
                >
                  <Icon size={16} aria-hidden="true" />
                </span>
                <span className="text-sm font-semibold text-ink-1">{option.label}</span>
                <span className="text-2xs leading-snug text-ink-4">{option.shortHint || option.hint}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── 1B. Classic content types (backward compatibility) ──────────── */}
      <section aria-labelledby="create-type-heading" className="space-y-2">
        <h2 id="create-type-heading" className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-4">
          Content type · Classic formats
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Content type">
          {CREATE_TYPES.map((option) => {
            const Icon = option.icon;
            const active =
              draft.content_type === option.value &&
              !(option.value === "opportunity" && draft.use_ledger);
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onPickClassicType(option.value)}
                data-testid={`create-type-${option.value}`}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors",
                  active
                    ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                    : "border-edge-1 bg-surface-1 hover:border-edge-2 hover:bg-surface-2",
                )}
              >
                <Icon size={14} className={active ? "text-brand-600 dark:text-brand-300" : "text-ink-4"} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-ink-1">{option.label}</span>
                  <span className="block truncate text-micro text-ink-4">{option.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── 2. Live category inference banner for Ledger activities ─────── */}
      {isLedgerMode && (
        <div
          data-testid="inferred-template-banner"
          className="flex items-start gap-3 rounded-card border border-brand-500/30 bg-brand-50/70 p-3.5 dark:bg-brand-500/10"
        >
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-500 text-white">
            <Sparkles size={15} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-bold text-ink-1">
                Inferred category: <span data-testid="inferred-template-label">{inference.label}</span>
              </p>
              <Badge variant="brand" size="sm">{inference.suggested_category}</Badge>
            </div>
            <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">{inference.reason}</p>
          </div>
        </div>
      )}

      {/* ── 3. Details & progressive category fields ────────────────────── */}
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
            isLedgerMode={isLedgerMode}
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

        {/* Progressive template-specific fields when in Local Activity Ledger mode */}
        {isLedgerMode && (
          <ProgressiveTemplateFields
            template={inference.inferred_template}
            draft={draft}
            setField={setField}
            setTemplateField={setTemplateField}
            setPermissionRule={setPermissionRule}
          />
        )}

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
                isLedgerMode={isLedgerMode}
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

        {preview && <Preview draft={draft} inference={isLedgerMode ? inference : null} />}
      </section>

      {/* ── 4. Publish ──────────────────────────────────────────────────── */}
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

/* ── Progressive template-specific sections ────────────────────────────────── */

function ProgressiveTemplateFields({ template, draft, setField, setTemplateField, setPermissionRule }) {
  const tf = draft.template_fields || {};

  if (template === "repair_artisan") {
    return (
      <div data-testid="template-fields-repair_artisan" className="space-y-3 rounded-xl border border-edge-1 bg-surface-0 p-3.5">
        <p className="text-xs font-bold text-ink-1">Repair & fundi details</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Materials already on hand"
            value={tf.materials_on_hand || ""}
            onChange={(e) => setTemplateField("materials_on_hand", e.target.value)}
            placeholder="e.g. Cedar posts & nails on site"
          />
          <Select
            label="When needed"
            options={FIELD_OPTIONS.urgency}
            value={tf.urgency || draft.urgency || "flexible"}
            onChange={(e) => {
              setTemplateField("urgency", e.target.value);
              setField("urgency", e.target.value);
            }}
          />
        </div>
        <Input
          label="Tools or specialist help needed"
          value={tf.tools_needed || ""}
          onChange={(e) => setTemplateField("tools_needed", e.target.value)}
          placeholder="e.g. Post-hole digger, wire stretcher"
        />
      </div>
    );
  }

  if (template === "agricultural_produce_fodder") {
    return (
      <div data-testid="template-fields-agricultural_produce_fodder" className="space-y-3 rounded-xl border border-edge-1 bg-surface-0 p-3.5">
        <p className="text-xs font-bold text-ink-1">Farm produce & fodder details (fractional quantities supported)</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Quantity (decimals ok, e.g. 2.5 or 12.5)"
            type="number"
            step="any"
            min={0}
            value={draft.quantity}
            onChange={(e) => setField("quantity", e.target.value)}
            placeholder="12.5"
            data-testid="create-fractional-quantity"
          />
          <Select
            label="Unit"
            options={FIELD_OPTIONS.unit}
            value={draft.unit || "bales"}
            onChange={(e) => setField("unit", e.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Moisture / grade / condition"
            value={tf.moisture_or_grade || ""}
            onChange={(e) => setTemplateField("moisture_or_grade", e.target.value)}
            placeholder="e.g. Freshly cut Napier, dry Boma Rhodes"
          />
          <Input
            label="Collection or delivery"
            value={tf.pickup_or_delivery || ""}
            onChange={(e) => setTemplateField("pickup_or_delivery", e.target.value)}
            placeholder="e.g. Farm-gate pickup or split pickup truck"
          />
        </div>
      </div>
    );
  }

  if (template === "group_sourcing") {
    return (
      <div data-testid="template-fields-group_sourcing" className="space-y-3 rounded-xl border border-edge-1 bg-surface-0 p-3.5">
        <p className="text-xs font-bold text-ink-1">Shared group sourcing pool</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            label="Target quantity (decimals ok)"
            type="number"
            step="any"
            min={0}
            value={tf.target_quantity || draft.quantity || ""}
            onChange={(e) => {
              setTemplateField("target_quantity", e.target.value ? Number(e.target.value) : "");
              setField("quantity", e.target.value);
            }}
            placeholder="40.5"
            data-testid="create-target-quantity"
          />
          <Select
            label="Unit"
            options={FIELD_OPTIONS.unit}
            value={draft.unit || "bales"}
            onChange={(e) => setField("unit", e.target.value)}
          />
          <Input
            label="Target unit price (KSh)"
            type="number"
            min={0}
            value={tf.target_unit_price_kes || ""}
            onChange={(e) => setTemplateField("target_unit_price_kes", e.target.value ? Number(e.target.value) : "")}
            placeholder="220"
          />
        </div>
        <Input
          label="Shared drop-off area"
          value={tf.dropoff_area || ""}
          onChange={(e) => setTemplateField("dropoff_area", e.target.value)}
          placeholder="e.g. Suneka junction / Nyanchwa stage"
        />
      </div>
    );
  }

  if (template === "travelling_round") {
    return (
      <div data-testid="template-fields-travelling_round" className="space-y-3 rounded-xl border border-edge-1 bg-surface-0 p-3.5">
        <p className="text-xs font-bold text-ink-1">Travelling artisan area round</p>
        <p className="text-2xs text-ink-4">
          Households can request private ordered stops along your route without exposing their gate directions publicly.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Craft or service"
            value={tf.craft || ""}
            onChange={(e) => setTemplateField("craft", e.target.value)}
            placeholder="e.g. Cobbler & leather repair"
          />
          <Input
            label="Maximum household stops"
            type="number"
            min={1}
            value={tf.max_stops || ""}
            onChange={(e) => setTemplateField("max_stops", e.target.value ? Number(e.target.value) : "")}
            placeholder="8"
          />
        </div>
      </div>
    );
  }

  if (template === "tool_lending") {
    return (
      <div data-testid="template-fields-tool_lending" className="space-y-3 rounded-xl border border-edge-1 bg-surface-0 p-3.5">
        <p className="text-xs font-bold text-ink-1">Tool lending & care rules</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Condition"
            value={tf.condition || ""}
            onChange={(e) => setTemplateField("condition", e.target.value)}
            placeholder="e.g. Good working order, greased wheel"
          />
          <Input
            label="Max borrow days"
            type="number"
            min={1}
            value={tf.max_borrow_days || ""}
            onChange={(e) => setTemplateField("max_borrow_days", e.target.value ? Number(e.target.value) : "")}
            placeholder="2"
          />
        </div>
        <Input
          label="Care or return rule"
          value={tf.deposit_or_care_rule || ""}
          onChange={(e) => setTemplateField("deposit_or_care_rule", e.target.value)}
          placeholder="e.g. Return washed before 6pm"
        />
      </div>
    );
  }

  if (template === "community_learning") {
    return (
      <div data-testid="template-fields-community_learning" className="space-y-3 rounded-xl border border-edge-1 bg-surface-0 p-3.5">
        <p className="text-xs font-bold text-ink-1">Community learning session</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Facilitator"
            value={tf.facilitator || ""}
            onChange={(e) => setTemplateField("facilitator", e.target.value)}
            placeholder="e.g. Teacher Ochieng / Agroforestry Group"
          />
          <Input
            label="Available seats"
            type="number"
            min={1}
            value={tf.max_seats || ""}
            onChange={(e) => setTemplateField("max_seats", e.target.value ? Number(e.target.value) : "")}
            placeholder="15"
          />
        </div>
      </div>
    );
  }

  if (template === "supervised_youth_task") {
    return (
      <div
        data-testid="template-fields-supervised_youth_task"
        className="space-y-3 rounded-xl border border-emerald-500/40 bg-emerald-50/60 p-3.5 dark:bg-emerald-500/10"
      >
        <div className="flex items-start gap-2">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
          <div>
            <p className="text-xs font-bold text-ink-1">Mandatory youth supervision & guardian consent</p>
            <p className="text-2xs text-ink-3">
              Server-enforced safety rules: daytime/holiday hours only, safe task domains only, named adult supervisor, and confirmed parent/guardian consent before any booking is agreed.
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Eligible age band"
            options={YOUTH_AGE_BANDS}
            value={tf.age_band || "16_17_supervised"}
            onChange={(e) => setTemplateField("age_band", e.target.value)}
            data-testid="youth-age-band"
          />
          <Select
            label="Safe task domain"
            options={YOUTH_SAFE_DOMAINS}
            value={tf.permitted_domain || "garden_help"}
            onChange={(e) => setTemplateField("permitted_domain", e.target.value)}
            data-testid="youth-permitted-domain"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Named adult supervisor"
            required
            value={tf.supervisor_name || ""}
            onChange={(e) => {
              setTemplateField("supervisor_name", e.target.value);
              setPermissionRule("is_youth_opportunity", true);
            }}
            placeholder="e.g. Grace Nyaboke"
            data-testid="youth-supervisor-name"
          />
          <Input
            label="Supervisor role / institution"
            value={tf.supervisor_role || ""}
            onChange={(e) => setTemplateField("supervisor_role", e.target.value)}
            placeholder="e.g. School Patron / Extension Educator"
          />
        </div>
        <Select
          label="Allowed schedule window"
          options={[
            { value: "daytime_only", label: "Daytime hours only (8am–5pm)" },
            { value: "school_holiday", label: "School holiday daytime" },
            { value: "weekend_daytime", label: "Weekend daytime" },
          ]}
          value={tf.schedule_window || "school_holiday"}
          onChange={(e) => setTemplateField("schedule_window", e.target.value)}
        />
      </div>
    );
  }

  return null;
}

/* ── one field ─────────────────────────────────────────────────────────────── */

function Field({
  field,
  draft,
  isLedgerMode,
  setField,
  bodyLabel,
  bodyPlaceholder,
  locationLabel: locLabel,
  fileRef,
  onFiles,
  uploading,
  removeMedia,
}) {
  const required = (TYPE_FIELDS[draft.content_type]?.required || []).includes(field);
  const options = FIELD_OPTIONS[field];

  switch (field) {
    case "title":
      return (
        <Input
          label="Title"
          required={required}
          value={draft.title}
          maxLength={220}
          onChange={(e) => setField("title", e.target.value)}
          placeholder={draft.content_type === "post" ? "Optional — a short headline" : "Give it a clear, practical title"}
          hint={required ? undefined : "Optional"}
          data-testid="create-title"
        />
      );

    case "body":
      return (
        <Textarea
          label={bodyLabel || "What's happening?"}
          required={required}
          rows={4}
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
          label={isLedgerMode ? "Neighbourhood or general area (public)" : "Where"}
          icon={MapPin}
          value={draft.location}
          maxLength={300}
          onChange={(e) => setField("location", e.target.value)}
          placeholder={locLabel || "e.g. Nyanchwa, Kisii · Muthaiga North · Kondele"}
          hint="An area is enough. Don't put a home address on something public."
          data-testid="create-location"
        />
      );

    case "private_directions":
      return (
        <Input
          label="Private gate / homestead directions (locked)"
          icon={Lock}
          value={draft.private_directions || ""}
          maxLength={500}
          onChange={(e) => setField("private_directions", e.target.value)}
          placeholder="e.g. Green hedge gate behind ACK church — call on arrival"
          hint="Hidden from the public feed. Shared only with an agreed booking participant and re-locked once completed."
          data-testid="create-private-directions"
        />
      );

    case "schedule_label":
      return (
        <Input
          label="Time window or schedule"
          icon={CalendarDays}
          value={draft.schedule_label || ""}
          maxLength={160}
          onChange={(e) => setField("schedule_label", e.target.value)}
          placeholder="e.g. Thursday 9am–4pm · Saturday 3pm–6pm"
          hint="Optional — plain words work well."
          data-testid="create-schedule-label"
        />
      );

    case "use_home_storefront":
      return (
        <label className="flex min-h-tap cursor-pointer items-start gap-2.5 rounded-xl border border-edge-1 bg-surface-0 p-3 text-xs text-ink-2">
          <input
            type="checkbox"
            checked={Boolean(draft.use_home_storefront)}
            onChange={(e) => setField("use_home_storefront", e.target.checked)}
            data-testid="create-use-home-storefront"
            className="mt-0.5 h-4 w-4 rounded border-edge-2 text-brand-600 focus:ring-brand-500"
          />
          <span>
            <strong className="font-semibold text-ink-1">Use my Home Storefront controls</strong> — apply my visiting hours and restrict visibility to my chosen home-shelf audience.
          </span>
        </label>
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
          placeholder="e.g. repairs, agriculture, cobbler"
          hint="Optional — automatically inferred if left blank."
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
          label={draft.content_type === "event" ? "How many people?" : "How many places / stops?"}
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
          label="Quantity"
          type="number"
          step={isLedgerMode ? "any" : "1"}
          min={0}
          value={draft.quantity}
          onChange={(e) => setField("quantity", e.target.value)}
          placeholder="0"
          hint={isLedgerMode ? "Optional — fractional quantities (e.g. 2.5) supported." : "Optional, but people like to know."}
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
          label="Price or guide rate (KSh)"
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

function Preview({ draft, inference }) {
  return (
    <div aria-label="Preview" className="rounded-card border border-edge-1 bg-surface-0 p-4">
      <p className="mb-2 flex items-center gap-1.5 text-micro font-bold uppercase tracking-[0.14em] text-ink-4">
        <Check size={12} aria-hidden="true" /> How it will look publicly
      </p>
      <div className="rounded-card-sm border border-edge-1 bg-surface-1 p-3">
        {(draft.media || []).length > 0 && (
          <img src={draft.media[0]} alt="" className="mb-2 aspect-[4/3] w-full rounded-card-sm object-cover" />
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip size="sm" active>{draft.content_type}</Chip>
          {inference && <Chip size="sm">{inference.label}</Chip>}
          {draft.visibility !== "public" && <Chip size="sm">{draft.visibility}</Chip>}
          {draft.price_kes && <Chip size="sm">KSh {draft.price_kes}</Chip>}
          {draft.use_home_storefront && (
            <Chip size="sm">
              <Store size={11} className="mr-1 inline" /> Home shelf
            </Chip>
          )}
        </div>
        {draft.title && <p className="mt-2 text-sm font-semibold text-ink-1">{draft.title}</p>}
        <p className="mt-1 whitespace-pre-line text-xs text-ink-2">
          {draft.body || <span className="text-ink-4">Nothing written yet.</span>}
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-4">
          {draft.location && <span className="inline-flex items-center gap-1"><MapPin size={11} aria-hidden="true" />{draft.location} (approximate)</span>}
          {draft.schedule_label && <span className="inline-flex items-center gap-1"><CalendarDays size={11} aria-hidden="true" />{draft.schedule_label}</span>}
          {draft.starts_at && <span className="inline-flex items-center gap-1"><CalendarDays size={11} aria-hidden="true" />{draft.starts_at.replace("T", " ")}</span>}
          {draft.private_directions && <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300"><Lock size={11} aria-hidden="true" />Exact directions locked until booking</span>}
        </p>
      </div>
      <p className="mt-2 text-2xs text-ink-4">
        {hasContent(draft)
          ? "This is what neighbours will see publicly. Private gate directions never appear here."
          : "Start typing and this fills in."}
      </p>
    </div>
  );
}
