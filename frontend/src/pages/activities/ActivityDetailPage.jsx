import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, BookmarkPlus, CalendarDays, CheckCircle2, Clock, Compass,
  Banknote, Lock, MapPin, RefreshCw, Repeat, ShieldCheck, Unlock,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import Skeleton from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { apiError } from "@/lib/api";
import { ledgerAPI } from "@/lib/ledgerApi";
import {
  LEDGER_STAGES, SETTLEMENT_METHODS, TEMPLATE_LABELS,
} from "@/lib/inference";
import { relativeTime } from "@/lib/formatters";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";

const POSTING_BADGES = {
  available: { label: "Available", variant: "brand" },
  wanted: { label: "Wanted", variant: "amber" },
  scheduled: { label: "Scheduled", variant: "purple" },
  opportunity: { label: "Opportunity", variant: "green" },
};

const ACCOUNT_KIND_LABELS = {
  person: "Person",
  household: "Household",
  artisan: "Artisan / Fundi",
  institution: "Institution",
  business: "Business",
};

export default function ActivityDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.vendor);

  const [activity, setActivity] = useState(null);
  const [alternatives, setAlternatives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Response form state
  const [respBody, setRespBody] = useState("");
  const [respPrice, setRespPrice] = useState("");
  const [respQty, setRespQty] = useState("");
  const [respAvail, setRespAvail] = useState("");
  const [respStopDir, setRespStopDir] = useState("");
  const [respGuardian, setRespGuardian] = useState("");
  const [submittingResp, setSubmittingResp] = useState(false);

  // Guardian consent state (keyed by response id)
  const [guardianOpenId, setGuardianOpenId] = useState(null);
  const [guardianForm, setGuardianForm] = useState({
    guardian_name: "",
    guardian_phone: "",
    relationship_to_youth: "Parent / Guardian",
  });

  // Booking builder state (keyed by response id)
  const [bookingRespId, setBookingRespId] = useState(null);
  const [bookingForm, setBookingForm] = useState({
    settlement_method: "direct_mpesa",
    agreed_price_kes: "",
    agreed_quantity: "",
    stop_sequence: "",
    scheduled_label: "",
  });

  // Agreed change form state (keyed by booking id)
  const [changeBookingId, setChangeBookingId] = useState(null);
  const [changeNote, setChangeNote] = useState("");

  // Feedback form state (keyed by booking id)
  const [feedbackBookingId, setFeedbackBookingId] = useState(null);
  const [feedbackForm, setFeedbackForm] = useState({
    attended_as_agreed: true,
    punctuality: "on_time",
    work_or_item_condition: "as_described",
    would_work_again: true,
    factual_note: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await ledgerAPI.getActivity(id);
      setActivity(data);
      if (data) {
        const altRes = await ledgerAPI.alternatives({
          template: data.inferred_template,
          category: data.category,
          exclude_vendor_id: data.owner?.id,
        });
        setAlternatives(altRes?.data?.items || []);
      }
    } catch (err) {
      setError(apiError(err, "Could not load this activity."));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-32 w-full rounded-card-lg" />
        <Skeleton className="h-24 w-full rounded-card-lg" />
        <Skeleton className="h-56 w-full rounded-card-lg" />
      </div>
    );
  }

  if (error || !activity) {
    return (
      <div className="mx-auto max-w-xl rounded-card-lg border border-edge-1 bg-surface-1 p-6 text-center space-y-3">
        <p className="text-sm font-semibold text-ink-1">{error || "Activity not found."}</p>
        <div className="flex justify-center gap-2">
          <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate("/explore")}>
            Back to Explore
          </Button>
          <Button icon={RefreshCw} onClick={load}>Retry</Button>
        </div>
      </div>
    );
  }

  const isOwner = Boolean(me?.id && activity.owner?.id === me.id);
  const pBadge = POSTING_BADGES[activity.posting_type] || POSTING_BADGES.available;
  const tplLabel = TEMPLATE_LABELS[activity.inferred_template] || "Neighbourhood Activity";
  const currentStageIdx = LEDGER_STAGES.findIndex((s) => s.key === activity.ledger_stage);
  const isYouth = Boolean(
    activity.inferred_template === "supervised_youth_task" ||
    activity.permission_rules?.guardian_consent_required,
  );
  const isRound = activity.inferred_template === "travelling_round";
  const isGroupSourcing = activity.inferred_template === "group_sourcing";
  const targetQty = Number(activity.template_fields?.target_quantity || activity.quantity || 0);
  const pledgedQty = Math.max(
    Number(activity.template_fields?.pledged_quantity || 0),
    (activity.responses || []).reduce(
      (sum, r) => sum + (Number(r.quantity_requested) || 0),
      0,
    ),
  );

  const defaultResponseKind = isRound
    ? "stop_request"
    : isGroupSourcing
    ? "pledge_quantity"
    : activity.posting_type === "wanted"
    ? "quote"
    : activity.inferred_template === "community_learning"
    ? "join_session"
    : "offer_help";

  const onSubmitResponse = async (e) => {
    e.preventDefault();
    if (!respBody.trim() && !respPrice && !respQty && !respStopDir.trim()) {
      toast.error("Write a short note, quote, or stop request first.");
      return;
    }
    setSubmittingResp(true);
    try {
      await ledgerAPI.respond(activity.id, {
        response_kind: defaultResponseKind,
        message: respBody.trim() || "Interested — let's arrange this.",
        offered_price_kes: respPrice ? Number(respPrice) : null,
        quantity_requested: respQty ? Number(respQty) : null,
        availability_note: respAvail.trim() || null,
        private_stop_directions: respStopDir.trim() || null,
        guardian_name_and_contact: respGuardian.trim() || null,
      });
      toast.success("Response recorded on the ledger");
      setRespBody("");
      setRespPrice("");
      setRespQty("");
      setRespAvail("");
      setRespStopDir("");
      setRespGuardian("");
      await load();
    } catch (err) {
      toast.error(apiError(err, "Could not send response"));
    } finally {
      setSubmittingResp(false);
    }
  };

  const onConfirmGuardian = async (responseId) => {
    if (!guardianForm.guardian_name.trim() || !guardianForm.guardian_phone.trim()) {
      toast.error("Enter the parent/guardian's full name and phone number.");
      return;
    }
    try {
      await ledgerAPI.confirmGuardianConsent(responseId, guardianForm);
      toast.success("Parent / guardian consent recorded");
      setGuardianOpenId(null);
      await load();
    } catch (err) {
      toast.error(apiError(err, "Could not record guardian consent"));
    }
  };

  const onCreateBooking = async (resp) => {
    try {
      await ledgerAPI.createBooking(activity.id, {
        response_id: resp.id,
        provider_vendor_id: activity.posting_type === "wanted" ? resp.responder?.id : activity.owner?.id,
        settlement_method: bookingForm.settlement_method,
        agreed_price_kes: bookingForm.agreed_price_kes
          ? Number(bookingForm.agreed_price_kes)
          : resp.offered_price_kes ?? activity.price_kes ?? null,
        agreed_quantity: bookingForm.agreed_quantity
          ? Number(bookingForm.agreed_quantity)
          : resp.quantity_requested ?? activity.quantity ?? null,
        agreed_unit: resp.unit || activity.unit || null,
        stop_sequence: bookingForm.stop_sequence ? Number(bookingForm.stop_sequence) : null,
        scheduled_label: bookingForm.scheduled_label || resp.availability_note || activity.schedule_label || null,
      });
      toast.success("Booking agreed — direct non-custodial settlement");
      setBookingRespId(null);
      await load();
    } catch (err) {
      toast.error(apiError(err, "Could not confirm booking"));
    }
  };

  const onProposeChange = async (bookingId) => {
    if (!changeNote.trim()) return;
    try {
      await ledgerAPI.proposeChange(bookingId, {
        kind: "agreed_update",
        summary: changeNote.trim(),
      });
      toast.success("Agreed change logged on the booking");
      setChangeBookingId(null);
      setChangeNote("");
      await load();
    } catch (err) {
      toast.error(apiError(err, "Could not save change"));
    }
  };

  const onConfirmCompletion = async (bookingId) => {
    try {
      await ledgerAPI.confirmCompletion(bookingId, { note: "Completed as agreed" });
      toast.success("Completion confirmed");
      await load();
    } catch (err) {
      toast.error(apiError(err, "Could not confirm completion"));
    }
  };

  const onSubmitFeedback = async (bookingId) => {
    try {
      await ledgerAPI.leaveFeedback(bookingId, feedbackForm);
      toast.success("Factual record saved — reusable record ready");
      setFeedbackBookingId(null);
      await load();
    } catch (err) {
      toast.error(apiError(err, "Could not save feedback"));
    }
  };

  const onRepeatBooking = async (bookingId) => {
    try {
      await ledgerAPI.repeatBooking(bookingId, { note: "Repeat arrangement from reusable record" });
      toast.success("Repeat booking created");
      await load();
    } catch (err) {
      toast.error(apiError(err, "Could not create repeat booking"));
    }
  };

  const onSaveRelationship = async (targetVendor, kind = "artisan") => {
    if (!targetVendor?.id) return;
    try {
      await ledgerAPI.saveRelationship({
        target_vendor_id: targetVendor.id,
        relationship_kind: kind,
        label: `${tplLabel} (${activity.area_name || activity.location || "local"})`,
      });
      toast.success(`Saved @${targetVendor.handle} to your local relationships`);
    } catch (err) {
      toast.error(apiError(err, "Could not save relationship"));
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between gap-2">
        <Link to="/explore" className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-3 hover:text-ink-1">
          <ArrowLeft size={14} aria-hidden="true" /> Back to Explore
        </Link>
        <span className="text-micro text-ink-4">Local Activity Ledger</span>
      </div>

      {/* ── 1. Activity Header ───────────────────────────────────────────── */}
      <section className="rounded-card-lg border border-edge-1 bg-surface-1 p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={pBadge.variant} size="sm">{pBadge.label}</Badge>
          <Badge variant="gray" size="sm">{tplLabel}</Badge>
          {activity.owner?.account_kind && (
            <Badge variant="blue" size="sm">
              {ACCOUNT_KIND_LABELS[activity.owner.account_kind] || activity.owner.account_kind}
            </Badge>
          )}
          {isYouth && (
            <Badge variant="green" size="sm">
              <ShieldCheck size={12} className="mr-1 inline" /> Supervised youth · Guardian consent required
            </Badge>
          )}
        </div>

        <div>
          <h1 className="text-title-page font-bold text-ink-1">{activity.title}</h1>
          {activity.body && (
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-2">
              {activity.body}
            </p>
          )}
        </div>

        <dl className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-edge-1 pt-3 text-xs text-ink-3">
          {(activity.area_name || activity.location) && (
            <div className="inline-flex items-center gap-1.5">
              <MapPin size={13} className="text-ink-4" aria-hidden="true" />
              <span>{activity.area_name || activity.location}</span>
              <span className="text-micro text-ink-4">(approximate area)</span>
            </div>
          )}
          {activity.schedule_label && (
            <div className="inline-flex items-center gap-1.5">
              <CalendarDays size={13} className="text-ink-4" aria-hidden="true" />
              <span>{activity.schedule_label}</span>
            </div>
          )}
          {activity.quantity != null && (
            <div className="inline-flex items-center gap-1.5 font-semibold text-ink-1">
              <span>{activity.quantity} {activity.unit || "units"}</span>
            </div>
          )}
          {activity.price_kes != null && (
            <div className="inline-flex items-center gap-1.5 font-bold text-ink-1 tabular-nums">
              <Banknote size={13} className="text-brand-600" aria-hidden="true" />
              <span>KSh {new Intl.NumberFormat("en-KE").format(activity.price_kes)}</span>
              {activity.price_unit && <span className="text-2xs font-normal text-ink-4">/ {activity.price_unit}</span>}
            </div>
          )}
          {activity.owner?.handle && (
            <div className="inline-flex items-center gap-2 ml-auto">
              <span className="text-ink-4">Posted by</span>
              <Link to={`/@${activity.owner.handle}`} className="font-semibold text-brand-700 dark:text-brand-300 hover:underline">
                {activity.owner.name} (@{activity.owner.handle})
              </Link>
              {!isOwner && (
                <button
                  type="button"
                  onClick={() => onSaveRelationship(activity.owner, activity.owner.account_kind || "neighbour")}
                  className="inline-flex items-center gap-1 rounded-full border border-edge-2 px-2.5 py-1 text-micro font-semibold text-ink-2 hover:border-brand-500"
                >
                  <BookmarkPlus size={11} aria-hidden="true" /> Save contact
                </button>
              )}
            </div>
          )}
        </dl>

        {/* Youth supervision details */}
        {isYouth && (
          <div
            data-testid="youth-supervision-summary"
            className="rounded-xl border border-emerald-500/30 bg-emerald-50/60 p-3 text-xs text-ink-2 dark:bg-emerald-500/10"
          >
            <p className="font-bold text-ink-1">Supervised Youth Safety Protections</p>
            <p className="mt-0.5 text-2xs text-ink-3">
              Supervisor: <strong>{activity.template_fields?.supervisor_name || "Named adult"}</strong>
              {activity.template_fields?.supervisor_role ? ` (${activity.template_fields.supervisor_role})` : ""} ·
              Age band: <strong>{activity.template_fields?.age_band || "Supervised"}</strong> ·
              Window: <strong>{activity.template_fields?.schedule_window || "Daytime only"}</strong>.
              Bookings stay locked until a parent or guardian confirms consent.
            </p>
          </div>
        )}

        {/* Group sourcing fractional progress bar */}
        {isGroupSourcing && targetQty > 0 && (
          <div data-testid="group-sourcing-progress" className="rounded-xl border border-edge-1 bg-surface-0 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-ink-1">Shared group pool progress</span>
              <span className="font-bold tabular-nums text-brand-700 dark:text-brand-300">
                {pledgedQty} / {targetQty} {activity.unit || "units"} pledged
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-brand-500 transition-all"
                style={{ width: `${Math.min(100, Math.round((pledgedQty / targetQty) * 100))}%` }}
              />
            </div>
          </div>
        )}
      </section>

      {/* ── 2. 6-Stage Local Activity Ledger Stepper ─────────────────────── */}
      <section
        aria-label="6-stage Local Activity Ledger"
        data-testid="ledger-stage-stepper"
        className="rounded-card-lg border border-edge-1 bg-surface-1 p-4 shadow-xs"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold uppercase tracking-[0.1em] text-ink-4">
            6-Stage Activity Lifecycle
          </h2>
          <Badge variant="brand" size="sm" data-testid="current-ledger-stage">
            Stage {Math.max(1, currentStageIdx + 1)} of 6 · {LEDGER_STAGES[Math.max(0, currentStageIdx)]?.label}
          </Badge>
        </div>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-6">
          {LEDGER_STAGES.map((st, idx) => {
            const reached = idx <= currentStageIdx;
            const current = idx === currentStageIdx;
            return (
              <li
                key={st.key}
                data-testid={`stage-${st.key}`}
                data-reached={reached ? "true" : "false"}
                className={cn(
                  "rounded-xl border px-2.5 py-2 text-left transition-colors",
                  current
                    ? "border-brand-500 bg-brand-50 dark:bg-brand-500/15"
                    : reached
                    ? "border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-500/10"
                    : "border-edge-1 bg-surface-0 opacity-70",
                )}
              >
                <span className="block text-micro font-mono text-ink-4">0{st.step}</span>
                <span className="mt-0.5 block text-2xs font-bold text-ink-1">{st.label}</span>
              </li>
            );
          })}
        </ol>
      </section>

      {/* ── 3. Privacy & Gate Directions Panel ───────────────────────────── */}
      {(activity.private_directions || activity.private_directions_locked) && (
        <section
          data-testid="privacy-directions-panel"
          className={cn(
            "flex items-start gap-3 rounded-card border p-4",
            activity.private_directions
              ? "border-emerald-500/40 bg-emerald-50/60 dark:bg-emerald-500/10"
              : "border-edge-1 bg-surface-1",
          )}
        >
          {activity.private_directions ? (
            <>
              <Unlock size={18} className="mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
              <div>
                <p className="text-xs font-bold text-ink-1">Private household / gate directions (unlocked for active booking)</p>
                <p className="mt-0.5 text-xs text-ink-2" data-testid="unlocked-private-directions">
                  {activity.private_directions}
                </p>
                <p className="mt-1 text-micro text-ink-4">
                  Automatically re-locked once both sides confirm completion.
                </p>
              </div>
            </>
          ) : (
            <>
              <Lock size={18} className="mt-0.5 shrink-0 text-ink-4" aria-hidden="true" />
              <div>
                <p className="text-xs font-bold text-ink-1">Exact household directions are locked</p>
                <p className="mt-0.5 text-2xs text-ink-3" data-testid="locked-private-directions-msg">
                  Public viewers only see the general neighbourhood ({activity.area_name || activity.location || "local area"}). Exact gate directions unlock strictly for an agreed booking participant during the active window, then re-lock after completion.
                </p>
              </div>
            </>
          )}
        </section>
      )}

      {/* ── 4. Respond / Quote / Join Round / Pledge Form ────────────────── */}
      {!isOwner && activity.status === "open" && (
        <section
          data-testid="activity-response-form"
          className="rounded-card-lg border border-edge-1 bg-surface-1 p-5 shadow-xs space-y-3"
        >
          <h2 className="text-title-section font-semibold text-ink-1">
            {isRound
              ? "Request a private household stop on this round"
              : isGroupSourcing
              ? "Pledge your share to this group order"
              : activity.posting_type === "wanted"
              ? "Send a quote or offer help"
              : "Respond or request a booking"}
          </h2>
          <form onSubmit={onSubmitResponse} className="space-y-3">
            <Textarea
              label="Message"
              rows={3}
              value={respBody}
              onChange={(e) => setRespBody(e.target.value)}
              placeholder={
                isRound
                  ? "e.g. 3 pairs of leather school shoes & 1 handbag strap repair…"
                  : "State what you can do, when you're free, or any questions…"
              }
              data-testid="response-message-input"
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                label="Quote / guide amount (KSh)"
                type="number"
                min={0}
                value={respPrice}
                onChange={(e) => setRespPrice(e.target.value)}
                placeholder="Optional"
                data-testid="response-price-input"
              />
              <Input
                label="Quantity (decimals ok)"
                type="number"
                step="any"
                min={0}
                value={respQty}
                onChange={(e) => setRespQty(e.target.value)}
                placeholder={activity.unit ? `in ${activity.unit}` : "Optional"}
                data-testid="response-quantity-input"
              />
              <Input
                label="Preferred window"
                value={respAvail}
                onChange={(e) => setRespAvail(e.target.value)}
                placeholder="e.g. Thu 10:30am"
              />
            </div>
            {isRound && (
              <Input
                label="Private household stop directions (visible only to you & the artisan)"
                icon={Lock}
                value={respStopDir}
                onChange={(e) => setRespStopDir(e.target.value)}
                placeholder="e.g. Off Limuru Rd, 2nd cedar gate on left — ring bell"
                data-testid="response-stop-directions-input"
              />
            )}
            {isYouth && (
              <Input
                label="Parent / guardian name & phone (required before booking)"
                icon={ShieldCheck}
                required
                value={respGuardian}
                onChange={(e) => setRespGuardian(e.target.value)}
                placeholder="e.g. Mary Kwamboka (Mother) · +2547…"
                hint="The organizer confirms consent with this guardian before any booking can be agreed."
                data-testid="response-guardian-contact-input"
              />
            )}
            <Button type="submit" loading={submittingResp} data-testid="submit-response-btn">
              Send response
            </Button>
          </form>
        </section>
      )}

      {/* ── 5. Responses, Guardian Consent & Non-Custodial Booking ───────── */}
      {(activity.responses || []).length > 0 && (
        <section data-testid="responses-panel" className="rounded-card-lg border border-edge-1 bg-surface-1 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-title-section font-semibold text-ink-1">
              Responses ({activity.responses.length})
            </h2>
            <span className="text-micro text-ink-4">Compare openly before agreeing</span>
          </div>
          <ul className="space-y-3">
            {activity.responses.map((resp) => {
              const needsConsent = isYouth && !resp.guardian_consent_confirmed;
              return (
                <li key={resp.id} className="rounded-card border border-edge-1 bg-surface-0 p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-ink-1">
                        {resp.responder?.name || "Neighbour"}
                      </span>
                      {resp.responder?.handle && (
                        <span className="text-2xs text-ink-4">@{resp.responder.handle}</span>
                      )}
                      <Badge variant="gray" size="sm">{resp.response_kind}</Badge>
                      <Badge variant={resp.status === "accepted" ? "green" : "blue"} size="sm">
                        {resp.status}
                      </Badge>
                    </div>
                    <span className="text-2xs text-ink-4">{relativeTime(resp.created_at)}</span>
                  </div>

                  {resp.message && <p className="text-xs text-ink-2">{resp.message}</p>}

                  <div className="flex flex-wrap items-center gap-3 text-2xs text-ink-3">
                    {resp.offered_price_kes != null && (
                      <span className="font-bold text-ink-1">Quote: KSh {resp.offered_price_kes}</span>
                    )}
                    {resp.quantity_requested != null && (
                      <span>Quantity: <strong>{resp.quantity_requested}</strong> {resp.unit || activity.unit || ""}</span>
                    )}
                    {resp.availability_note && (
                      <span className="inline-flex items-center gap-1"><Clock size={11} /> {resp.availability_note}</span>
                    )}
                  </div>

                  {resp.private_stop_directions && (
                    <p className="rounded-lg bg-emerald-50/70 px-3 py-1.5 text-2xs text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200">
                      <Lock size={11} className="mr-1 inline" />
                      Private stop directions: {resp.private_stop_directions}
                    </p>
                  )}

                  {/* Youth guardian consent status / form */}
                  {isYouth && (
                    <div className="rounded-lg border border-edge-1 bg-surface-1 p-3 space-y-2">
                      {resp.guardian_consent_confirmed ? (
                        <p className="text-2xs font-semibold text-emerald-700 dark:text-emerald-300" data-testid={`guardian-confirmed-${resp.id}`}>
                          <CheckCircle2 size={13} className="mr-1 inline" />
                          Parent / guardian consent confirmed ({resp.guardian_name || "Guardian"})
                        </p>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-2xs text-amber-800 dark:text-amber-300">
                              Awaiting parent / guardian consent before a booking can be agreed.
                            </p>
                            <Button
                              size="xs"
                              variant="secondary"
                              onClick={() => setGuardianOpenId(guardianOpenId === resp.id ? null : resp.id)}
                              data-testid={`open-guardian-consent-${resp.id}`}
                            >
                              Record guardian consent
                            </Button>
                          </div>
                          {guardianOpenId === resp.id && (
                            <div className="grid gap-2 pt-2 sm:grid-cols-3">
                              <Input
                                label="Guardian full name"
                                value={guardianForm.guardian_name}
                                onChange={(e) => setGuardianForm((f) => ({ ...f, guardian_name: e.target.value }))}
                                data-testid="guardian-name-input"
                              />
                              <Input
                                label="Guardian phone"
                                value={guardianForm.guardian_phone}
                                onChange={(e) => setGuardianForm((f) => ({ ...f, guardian_phone: e.target.value }))}
                                data-testid="guardian-phone-input"
                              />
                              <div className="flex items-end">
                                <Button
                                  size="sm"
                                  onClick={() => onConfirmGuardian(resp.id)}
                                  data-testid="submit-guardian-consent-btn"
                                >
                                  Confirm consent
                                </Button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Owner action: Agree non-custodial booking */}
                  {isOwner && resp.status !== "accepted" && (
                    <div className="pt-1">
                      <Button
                        size="xs"
                        disabled={needsConsent}
                        onClick={() => {
                          setBookingRespId(bookingRespId === resp.id ? null : resp.id);
                          setBookingForm((f) => ({
                            ...f,
                            agreed_price_kes: resp.offered_price_kes ?? activity.price_kes ?? "",
                            agreed_quantity: resp.quantity_requested ?? activity.quantity ?? "",
                            scheduled_label: resp.availability_note || activity.schedule_label || "",
                          }));
                        }}
                        data-testid={`open-booking-${resp.id}`}
                      >
                        {needsConsent ? "Waiting on guardian consent" : "Agree non-custodial booking"}
                      </Button>

                      {bookingRespId === resp.id && (
                        <div className="mt-3 rounded-xl border border-brand-500/30 bg-surface-1 p-3.5 space-y-3">
                          <p className="text-2xs text-ink-3">
                            <strong>Strictly non-custodial:</strong> Ogallo never holds or routes customer funds. Choose how you and your neighbour will settle directly:
                          </p>
                          <div className="grid gap-2.5 sm:grid-cols-2">
                            <Select
                              label="Direct settlement method"
                              options={SETTLEMENT_METHODS}
                              value={bookingForm.settlement_method}
                              onChange={(e) => setBookingForm((f) => ({ ...f, settlement_method: e.target.value }))}
                              data-testid="booking-settlement-select"
                            />
                            <Input
                              label="Agreed amount (KSh, optional)"
                              type="number"
                              min={0}
                              value={bookingForm.agreed_price_kes}
                              onChange={(e) => setBookingForm((f) => ({ ...f, agreed_price_kes: e.target.value }))}
                            />
                          </div>
                          {isRound && (
                            <Input
                              label="Ordered stop number on your round (1, 2, 3…)"
                              type="number"
                              min={1}
                              value={bookingForm.stop_sequence}
                              onChange={(e) => setBookingForm((f) => ({ ...f, stop_sequence: e.target.value }))}
                              data-testid="booking-stop-sequence"
                            />
                          )}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => onCreateBooking(resp)}
                              data-testid={`confirm-booking-${resp.id}`}
                            >
                              Confirm booking on ledger
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setBookingRespId(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── 6. Active & Completed Bookings + Mutual Completion + Feedback ── */}
      {(activity.bookings || []).length > 0 && (
        <section data-testid="bookings-panel" className="rounded-card-lg border border-edge-1 bg-surface-1 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-title-section font-semibold text-ink-1">
              Agreed Bookings ({activity.bookings.length})
            </h2>
            <Badge variant="brand" size="sm">Non-custodial</Badge>
          </div>

          <ul className="space-y-3">
            {activity.bookings.map((bk) => {
              const isCompleted = bk.status === "completed";
              const counterparty =
                bk.provider?.id === me?.id ? bk.initiator : bk.provider;
              return (
                <li key={bk.id} className="rounded-card border border-edge-1 bg-surface-0 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={isCompleted ? "green" : "brand"} size="sm">
                        {bk.status}
                      </Badge>
                      {bk.stop_sequence != null && (
                        <Badge variant="purple" size="sm">Stop #{bk.stop_sequence}</Badge>
                      )}
                      <span className="text-xs font-semibold text-ink-1">
                        {bk.initiator?.name} ↔ {bk.provider?.name}
                      </span>
                    </div>
                    <span className="text-2xs font-medium text-ink-3">
                      Settlement: {bk.settlement_method?.replace(/_/g, " ")} (direct)
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-3 text-xs text-ink-3">
                    {bk.agreed_price_kes != null && (
                      <span className="font-bold text-ink-1">Agreed: KSh {bk.agreed_price_kes}</span>
                    )}
                    {bk.agreed_quantity != null && (
                      <span>Quantity: {bk.agreed_quantity} {bk.agreed_unit || ""}</span>
                    )}
                    {bk.scheduled_label && <span>Schedule: {bk.scheduled_label}</span>}
                  </div>

                  {bk.private_stop_directions && (
                    <p className="rounded-lg bg-emerald-50/70 px-3 py-1.5 text-2xs text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200">
                      <Unlock size={11} className="mr-1 inline" />
                      Stop directions (active window only): {bk.private_stop_directions}
                    </p>
                  )}

                  {/* Two-party completion badges */}
                  <div className="flex flex-wrap items-center gap-2 text-2xs">
                    <span className={cn("rounded-full px-2.5 py-0.5 font-medium", bk.initiator_confirmed_at ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200" : "bg-surface-2 text-ink-4")}>
                      Initiator: {bk.initiator_confirmed_at ? "Confirmed" : "Pending"}
                    </span>
                    <span className={cn("rounded-full px-2.5 py-0.5 font-medium", bk.provider_confirmed_at ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200" : "bg-surface-2 text-ink-4")}>
                      Provider: {bk.provider_confirmed_at ? "Confirmed" : "Pending"}
                    </span>
                  </div>

                  {/* Agreed changes log */}
                  {(bk.agreed_changes || []).length > 0 && (
                    <ul className="rounded-lg bg-surface-1 p-2.5 text-2xs text-ink-3 space-y-1">
                      {bk.agreed_changes.map((ch, idx) => (
                        <li key={idx}>• Agreed update: {ch.summary || ch.note}</li>
                      ))}
                    </ul>
                  )}

                  {/* Actions for active vs completed bookings */}
                  {!isCompleted ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="xs"
                        icon={CheckCircle2}
                        onClick={() => onConfirmCompletion(bk.id)}
                        data-testid={`confirm-completion-${bk.id}`}
                      >
                        Confirm completion
                      </Button>
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() => setChangeBookingId(changeBookingId === bk.id ? null : bk.id)}
                      >
                        Log agreed change
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() => setFeedbackBookingId(feedbackBookingId === bk.id ? null : bk.id)}
                        data-testid={`open-feedback-${bk.id}`}
                      >
                        Record factual outcome
                      </Button>
                      <Button
                        size="xs"
                        icon={Repeat}
                        onClick={() => onRepeatBooking(bk.id)}
                        data-testid={`repeat-booking-${bk.id}`}
                      >
                        Repeat booking
                      </Button>
                      {counterparty && (
                        <Button
                          size="xs"
                          variant="ghost"
                          icon={BookmarkPlus}
                          onClick={() => onSaveRelationship(counterparty, counterparty.account_kind || "artisan")}
                        >
                          Save @{counterparty.handle}
                        </Button>
                      )}
                    </div>
                  )}

                  {changeBookingId === bk.id && (
                    <div className="flex gap-2 pt-2">
                      <Input
                        value={changeNote}
                        onChange={(e) => setChangeNote(e.target.value)}
                        placeholder="e.g. Moved start time to 10am; added 2 extra cedar posts"
                      />
                      <Button size="sm" onClick={() => onProposeChange(bk.id)}>Save</Button>
                    </div>
                  )}

                  {feedbackBookingId === bk.id && (
                    <div className="rounded-xl border border-edge-1 bg-surface-1 p-3.5 space-y-2.5">
                      <p className="text-xs font-bold text-ink-1">Factual completion record (turns booking into Stage 6 Reusable Record)</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Select
                          label="Punctuality"
                          options={[
                            { value: "on_time", label: "On time as agreed" },
                            { value: "communicated_delay", label: "Communicated change" },
                            { value: "late", label: "Late" },
                          ]}
                          value={feedbackForm.punctuality}
                          onChange={(e) => setFeedbackForm((f) => ({ ...f, punctuality: e.target.value }))}
                        />
                        <Select
                          label="Work / item condition"
                          options={[
                            { value: "as_described", label: "Completed as agreed" },
                            { value: "partial", label: "Partially completed" },
                            { value: "issue_noted", label: "Issue noted" },
                          ]}
                          value={feedbackForm.work_or_item_condition}
                          onChange={(e) => setFeedbackForm((f) => ({ ...f, work_or_item_condition: e.target.value }))}
                        />
                      </div>
                      <Input
                        label="Short factual note"
                        value={feedbackForm.factual_note}
                        onChange={(e) => setFeedbackForm((f) => ({ ...f, factual_note: e.target.value }))}
                        placeholder="e.g. 6 fence posts replaced and strained cleanly"
                        data-testid="feedback-note-input"
                      />
                      <Button size="sm" onClick={() => onSubmitFeedback(bk.id)} data-testid="submit-feedback-btn">
                        Save factual record
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── 7. Freedom of Choice: Local Alternatives alongside Repeat ────── */}
      <section
        data-testid="local-alternatives-panel"
        className="rounded-card-lg border border-edge-1 bg-surface-1 p-5 shadow-xs space-y-3"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-title-section font-semibold text-ink-1 flex items-center gap-2">
              <Compass size={16} className="text-brand-600" aria-hidden="true" />
              Local alternatives & open comparison
            </h2>
            <p className="mt-0.5 text-2xs text-ink-3">
              Saved contacts and repeat bookings are convenient, never a lock-in. Compare other active providers and activities in {tplLabel.toLowerCase()}.
            </p>
          </div>
          <Link to={`/explore?q=${encodeURIComponent(activity.category || tplLabel)}`}>
            <Button size="xs" variant="secondary">Explore all</Button>
          </Link>
        </div>

        {alternatives.length === 0 ? (
          <p className="text-xs text-ink-4">
            No other open {tplLabel.toLowerCase()} listings nearby right now — you can post a Wanted request anytime to compare fresh quotes.
          </p>
        ) : (
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {alternatives.map((alt) => (
              <li key={alt.id} className="rounded-xl border border-edge-1 bg-surface-0 p-3 flex flex-col justify-between gap-2">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="gray" size="sm">{alt.posting_type}</Badge>
                    {alt.price_kes != null && (
                      <span className="text-xs font-bold tabular-nums text-ink-1">KSh {alt.price_kes}</span>
                    )}
                  </div>
                  <Link to={`/activities/${alt.id}`} className="mt-1.5 block text-xs font-bold text-ink-1 hover:text-brand-700">
                    {alt.title}
                  </Link>
                  <p className="mt-0.5 text-2xs text-ink-4">
                    {alt.owner?.name} (@{alt.owner?.handle}) · {alt.area_name || alt.location || "Nearby"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 8. Ledger Event Timeline ─────────────────────────────────────── */}
      {(activity.ledger_events || []).length > 0 && (
        <section data-testid="ledger-events-timeline" className="rounded-card-lg border border-edge-1 bg-surface-1 p-5 shadow-xs space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-[0.1em] text-ink-4">
            Ledger Audit Trail
          </h2>
          <ol className="space-y-2 text-xs">
            {activity.ledger_events.map((ev) => (
              <li key={ev.id} className="flex items-start justify-between gap-3 border-b border-edge-1 pb-2 last:border-b-0 last:pb-0">
                <div>
                  <span className="font-mono text-micro uppercase text-brand-700 dark:text-brand-300 mr-2">
                    {ev.event_type}
                  </span>
                  <span className="text-ink-2">{ev.summary}</span>
                </div>
                <span className="shrink-0 text-2xs text-ink-4">{relativeTime(ev.created_at)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
