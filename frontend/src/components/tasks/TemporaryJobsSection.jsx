import { useMemo, useState } from "react";
import {
  Briefcase, CheckCircle2, ClipboardList, Clock, Footprints, Info, Lock, MapPin,
  Package, Plus, ShieldCheck, Sparkles, Star, Store, Truck, Users, Utensils, Wrench, AlertTriangle,
} from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";
import { squadAPI, apiError } from "@/lib/api";
import { currency, num, relativeTime, shortDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";

export const JOB_CATEGORIES = [
  {
    skill: "cleaner",
    title: "Packing & Stock Prep",
    shortLabel: "Packing",
    subtitle: "Sorting, grading, crate cleaning & order packing",
    minWage: 200,
    unit: "per shift",
    icon: Package,
    tone: "bg-brand-50 text-brand-700 dark:bg-surface-2 dark:text-brand-300",
  },
  {
    skill: "mover",
    title: "Loading & Warehouse",
    shortLabel: "Loading",
    subtitle: "Lorry offloading, pallet stacking & bay handling",
    minWage: 400,
    unit: "per shift",
    icon: Users,
    tone: "bg-blue-50 text-blue-700 dark:bg-surface-2 dark:text-blue-300",
  },
  {
    skill: "rider",
    title: "Delivery & Dispatch",
    shortLabel: "Delivery",
    subtitle: "Last-mile runner, boda drops & inter-stall dispatch",
    minWage: 200,
    unit: "per run",
    icon: Truck,
    tone: "bg-accent-50 text-accent-700 dark:bg-surface-2 dark:text-accent-300",
  },
  {
    skill: "digital",
    title: "Inventory & Counting",
    shortLabel: "Inventory",
    subtitle: "Shelf stocktaking, batch logging & POS entry",
    minWage: 300,
    unit: "per shift",
    icon: ClipboardList,
    tone: "bg-purple-50 text-purple-700 dark:bg-surface-2 dark:text-purple-300",
  },
  {
    skill: "shopper",
    title: "Retail & Merchandising",
    shortLabel: "Retail & Display",
    subtitle: "Stall assistance, display setup & peak-hour help",
    minWage: 150,
    unit: "per shift",
    icon: Store,
    tone: "bg-teal-50 text-teal-700 dark:bg-surface-2 dark:text-teal-300",
  },
  {
    skill: "fundi",
    title: "Repairs & Fixtures",
    shortLabel: "Repairs (Fundi)",
    subtitle: "Shelving, shutter fixes, scales & stall maintenance",
    minWage: 500,
    unit: "per job",
    icon: Wrench,
    tone: "bg-rose-50 text-rose-700 dark:bg-surface-2 dark:text-rose-300",
  },
  {
    skill: "cook",
    title: "Food & Produce Prep",
    shortLabel: "Produce Prep",
    subtitle: "Fresh produce trimming, washing & kitchen support",
    minWage: 350,
    unit: "per shift",
    icon: Utensils,
    tone: "bg-accent-50 text-accent-700 dark:bg-surface-2 dark:text-accent-300",
  },
  {
    skill: "errand",
    title: "Market Runs & Seasonal",
    shortLabel: "Market Errands",
    subtitle: "Wholesale collection, packaging pickup & queue help",
    minWage: 150,
    unit: "per task",
    icon: Footprints,
    tone: "bg-brand-50 text-brand-700 dark:bg-surface-2 dark:text-brand-300",
  },
];

export function categoryForSkill(skill = "") {
  const found = JOB_CATEGORIES.find((c) => c.skill === skill);
  if (found) return found;
  return {
    skill: skill || "general",
    title: skill ? `${skill.charAt(0).toUpperCase()}${skill.slice(1)} Work` : "Temporary Shift",
    shortLabel: skill || "Shift",
    subtitle: "Verified on-site business assistance",
    minWage: 200,
    unit: "per shift",
    icon: Briefcase,
    tone: "bg-brand-50 text-brand-700 dark:bg-surface-2 dark:text-brand-300",
  };
}

export function getJobCallState(call = {}, { hasActiveContract = false, energyCapReached = false } = {}) {
  const now = Date.now();
  const expiredByDate = call.expires_at ? new Date(call.expires_at).getTime() < now : false;
  const status = call.status || "open";

  if (status === "cancelled") {
    return { code: "cancelled", label: "Cancelled", badgeVariant: "gray", canApply: false, reason: "This job post was cancelled by the business." };
  }
  if (status === "completed") {
    return { code: "filled", label: "Completed", badgeVariant: "blue", canApply: false, reason: "This shift has already been completed." };
  }
  if (status === "contracted" || status === "in_progress" || status === "proof_pending" || call.worker) {
    return { code: "filled", label: "Position filled", badgeVariant: "amber", canApply: false, reason: "Another worker has already been contracted for this shift." };
  }
  if (expiredByDate || status === "expired") {
    return { code: "expired", label: "Expired", badgeVariant: "gray", canApply: false, reason: "The application window for this shift has closed." };
  }
  if (call.mine) {
    return { code: "mine", label: "Your job post", badgeVariant: "purple", canApply: false, reason: "Posted by your business." };
  }
  if (hasActiveContract) {
    return { code: "restricted_active", label: "Open shift", badgeVariant: "brand", canApply: false, reason: "Finish your current active contract before accepting another shift." };
  }
  if (energyCapReached) {
    return { code: "restricted_energy", label: "Open shift", badgeVariant: "brand", canApply: false, reason: "Daily safe shift limit reached (4/4). Rest today and apply tomorrow." };
  }
  return { code: "open", label: "Open shift", badgeVariant: "brand", canApply: true, reason: null };
}

/**
 * Hero Banner for the Temporary-Jobs Landing Page & Portfolio.
 */
export function TemporaryJobsHero({ onBrowseJobs, onPostJob, openCount = 0, activeContract = null }) {
  return (
    <section
      className="rounded-3xl border border-edge-1 bg-surface-0 shadow-sm overflow-hidden"
      data-testid="temp-jobs-hero"
    >
      <div className="grid lg:grid-cols-[1.2fr_0.8fr] items-stretch">
        {/* Left: Headline, value proposition, primary actions */}
        <div className="p-5 sm:p-7 flex flex-col justify-between gap-5">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="brand" size="xs">
                <ShieldCheck size={11} /> Verified Marketplace Shifts
              </Badge>
              {openCount > 0 && (
                <Badge variant="amber" size="xs">
                  {num(openCount)} open {openCount === 1 ? "job" : "jobs"} near you
                </Badge>
              )}
              {activeContract && (
                <Badge variant="blue" size="xs">
                  1 active contract in progress
                </Badge>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold text-ink-1 tracking-tight leading-tight">
              Good people. Ready when business needs them.
            </h1>

            <p className="text-xs sm:text-sm text-ink-2 max-w-xl leading-relaxed">
              Hire reliable hands for stock counting, crate packing, lorry offloading, stall merchandising, and local deliveries — or pick up verified shifts with upfront KES rates and two-party completion proof.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <Button size="md" onClick={onBrowseJobs}>
              Browse Jobs
            </Button>
            {onPostJob && (
              <Button size="md" variant="secondary" icon={Plus} onClick={onPostJob}>
                Post a Job
              </Button>
            )}
            <div className="flex items-center gap-3 text-micro text-ink-3 ml-auto">
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 size={12} className="text-brand-600" /> Upfront KES pay
              </span>
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 size={12} className="text-brand-600" /> 2-party OTP proof
              </span>
            </div>
          </div>
        </div>

        {/* Right: Illustrated Hero Artwork (Warehouse, Packing, Stock Handling, Distribution) */}
        <div
          className="bg-surface-1 border-t lg:border-t-0 lg:border-l border-edge-1 p-5 flex items-center justify-center"
          aria-hidden="true"
        >
          <svg viewBox="0 0 360 220" className="w-full max-w-sm h-auto" fill="none">
            {/* Warehouse bay backdrop */}
            <rect x="14" y="16" width="332" height="188" rx="18" className="fill-surface-0 stroke-edge-2" strokeWidth="1.5" />
            <path d="M34 62L180 26L326 62" className="stroke-brand-600" strokeWidth="2.5" strokeLinecap="round" />
            {/* Shelving & stock crates */}
            <rect x="40" y="74" width="96" height="96" rx="8" className="fill-surface-1 stroke-edge-2" strokeWidth="1.5" />
            <line x1="40" y1="106" x2="136" y2="106" className="stroke-edge-2" strokeWidth="1.5" />
            <line x1="40" y1="138" x2="136" y2="138" className="stroke-edge-2" strokeWidth="1.5" />
            <rect x="50" y="82" width="28" height="20" rx="4" className="fill-brand-600" />
            <rect x="84" y="82" width="38" height="20" rx="4" className="fill-accent-500" />
            <rect x="50" y="114" width="36" height="20" rx="4" className="fill-brand-100 stroke-brand-600" strokeWidth="1.2" />
            <rect x="92" y="114" width="32" height="20" rx="4" className="fill-brand-600" />
            <rect x="50" y="144" width="72" height="20" rx="4" className="fill-surface-2 stroke-edge-3" strokeWidth="1.2" />

            {/* Worker & shift dispatch cards on right */}
            <rect x="154" y="72" width="170" height="46" rx="10" className="fill-surface-1 stroke-brand-500" strokeWidth="1.5" />
            <circle cx="176" cy="95" r="12" className="fill-brand-600" />
            <path d="M171 95L174.5 98.5L182 91" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="196" y="84" width="78" height="7" rx="3.5" className="fill-ink-1" />
            <rect x="196" y="96" width="54" height="6" rx="3" className="fill-brand-600" />
            <rect x="282" y="86" width="32" height="16" rx="8" className="fill-brand-50 stroke-brand-600" strokeWidth="1" />

            <rect x="154" y="126" width="170" height="46" rx="10" className="fill-surface-1 stroke-edge-2" strokeWidth="1.5" />
            <circle cx="176" cy="149" r="12" className="fill-accent-500" />
            <rect x="196" y="138" width="88" height="7" rx="3.5" className="fill-ink-2" />
            <rect x="196" y="150" width="62" height="6" rx="3" className="fill-ink-4" />
            <rect x="282" y="140" width="32" height="16" rx="8" className="fill-surface-0 stroke-edge-2" strokeWidth="1" />

            {/* Bottom status strip */}
            <rect x="40" y="178" width="284" height="16" rx="6" className="fill-brand-50" />
          </svg>
        </div>
      </div>
    </section>
  );
}

/**
 * Visual Category Cards for Temporary Work.
 */
export function JobCategoryGrid({ activeSkill, onSelectSkill, calls = [] }) {
  const counts = useMemo(() => {
    const bySkill = {};
    for (const c of calls || []) {
      if (c.status === "open" || !c.status) {
        bySkill[c.skill] = (bySkill[c.skill] || 0) + 1;
      }
    }
    return bySkill;
  }, [calls]);

  return (
    <section className="space-y-2.5" aria-label="Temporary work categories">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-ink-1">Browse by work category</h2>
          <p className="text-2xs text-ink-3">Select a category to filter available shifts and minimum rates</p>
        </div>
        {activeSkill && (
          <Button size="xs" variant="ghost" onClick={() => onSelectSkill("")}>
            Show all categories
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {JOB_CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const active = activeSkill === cat.skill;
          const openCount = counts[cat.skill] || 0;
          return (
            <button
              key={cat.skill}
              type="button"
              onClick={() => onSelectSkill(active ? "" : cat.skill)}
              aria-pressed={active}
              data-testid={`job-category-${cat.skill}`}
              className={cn(
                "flex flex-col justify-between rounded-2xl border p-3.5 text-left transition-all cursor-pointer bg-surface-0 shadow-2xs",
                active
                  ? "border-brand-600 ring-2 ring-brand-500/20"
                  : "border-edge-1 hover:border-edge-2 hover:shadow-xs"
              )}
            >
              <div className="flex items-start justify-between gap-2 w-full">
                <span className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-edge-1", cat.tone)}>
                  <Icon size={18} />
                </span>
                {openCount > 0 ? (
                  <Badge variant="brand" size="xs">
                    {openCount} open
                  </Badge>
                ) : (
                  <span className="text-micro font-mono text-ink-4">≥ {currency(cat.minWage)}</span>
                )}
              </div>
              <div className="mt-3">
                <p className="text-xs font-semibold text-ink-1 leading-snug">{cat.title}</p>
                <p className="text-micro text-ink-3 mt-0.5 line-clamp-2 leading-snug">{cat.subtitle}</p>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Image-Led Job Card showing job title, pay rate and unit, location, shift/duration,
 * essential requirements, business identity, verified info, and View Job + Apply actions.
 */
export function JobCard({
  call,
  onViewJob,
  onApply,
  applying = false,
  hasActiveContract = false,
  energyCapReached = false,
  actionLabel = "Apply",
}) {
  const cat = categoryForSkill(call.skill);
  const Icon = cat.icon;
  const state = getJobCallState(call, { hasActiveContract, energyCapReached });
  const clientName = call.client || call.business_name || (call.vendor_handle ? `@${call.vendor_handle}` : "Verified Business");
  const shiftUnit = call.task_type === "delivery" ? "/ run" : "/ shift";

  return (
    <article
      className={cn(
        "flex flex-col rounded-2xl border border-edge-1 bg-surface-0 shadow-xs overflow-hidden glass-hover h-full",
        (state.code === "expired" || state.code === "cancelled") && "opacity-75"
      )}
      data-testid="job-card"
    >
      {/* Visual Header Banner */}
      <div className={cn("relative px-4 py-3.5 border-b border-edge-1 flex items-center justify-between gap-3", cat.tone)}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-surface-0 border border-edge-1 shadow-2xs flex items-center justify-center shrink-0">
            <Icon size={19} />
          </div>
          <div className="min-w-0">
            <span className="block text-micro font-bold uppercase tracking-wider opacity-80 truncate">
              {cat.title}
            </span>
            <span className="block text-xs font-semibold text-ink-1 truncate">
              {call.task_type ? call.task_type.replaceAll("_", " ") : "On-site shift"}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end shrink-0">
          <Badge variant={state.badgeVariant} size="xs">
            {state.label}
          </Badge>
        </div>
      </div>

      {/* Card Body */}
      <div className="flex flex-col flex-1 p-4 gap-3">
        {/* Title & Business Identity */}
        <div>
          <h3 className="text-sm font-semibold text-ink-1 leading-snug line-clamp-2">{call.title}</h3>
          <div className="mt-1.5 flex items-center gap-2 text-2xs text-ink-3">
            <Avatar name={clientName} size="xs" />
            <span className="font-medium text-ink-2 truncate">{clientName}</span>
            <span className="inline-flex items-center gap-0.5 text-micro text-brand-700 dark:text-brand-300 shrink-0 ml-auto">
              <ShieldCheck size={11} /> OTP verified pay
            </span>
          </div>
        </div>

        {/* Pay Rate, Location, Shift Duration & Requirements */}
        <div className="rounded-xl bg-surface-1 border border-edge-1 p-3 space-y-2 mt-auto">
          <div className="flex items-end justify-between gap-2">
            <div>
              <span className="block text-micro uppercase tracking-wider font-bold text-ink-4">Pay rate</span>
              <span className="text-lg font-bold text-ink-1 tabular-nums leading-tight">
                KES {num(call.pay_kes)}
                <span className="text-2xs font-normal text-ink-4"> {shiftUnit}</span>
              </span>
            </div>
            <div className="text-right">
              <span className="block text-micro uppercase tracking-wider font-bold text-ink-4">Location</span>
              <span className="text-xs font-semibold text-ink-1 inline-flex items-center gap-1">
                <MapPin size={11} className="text-brand-600 shrink-0" />
                <span className="truncate max-w-[9rem]">{call.location || "Market zone"}</span>
                {typeof call.distance_km === "number" && (
                  <span className="text-micro font-mono text-ink-4">({call.distance_km} km)</span>
                )}
              </span>
            </div>
          </div>

          <div className="pt-2 border-t border-edge-1 flex flex-wrap items-center justify-between gap-2 text-micro text-ink-3">
            <span className="inline-flex items-center gap-1">
              <Clock size={11} className="text-ink-4" />
              {call.expires_at ? `Window closes ${relativeTime(call.expires_at)}` : "Immediate shift"}
            </span>
            <span className="font-medium text-ink-2">
              Tier: <strong className="capitalize">{call.required_tier || "common"}</strong>
              {call.squad_id ? " · Squad shift" : ""}
            </span>
          </div>
        </div>

        {/* State notice if restricted / filled / expired */}
        {state.reason && state.code !== "open" && (
          <p className="text-micro text-ink-3 bg-surface-1 rounded-lg px-2.5 py-1.5 border border-edge-1">
            {state.reason}
          </p>
        )}

        {/* Primary & Secondary Actions */}
        <div className="flex items-center gap-2 pt-0.5">
          {onViewJob && (
            <Button size="sm" variant="secondary" icon={Info} onClick={() => onViewJob(call)} className="flex-1">
              View Job
            </Button>
          )}
          {state.code === "mine" ? (
            <Button size="sm" variant="outline" onClick={() => onViewJob?.(call)} className="flex-1">
              Manage Post
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={!state.canApply || applying}
              loading={applying}
              onClick={() => onApply?.(call)}
              className="flex-1"
            >
              {state.code === "filled"
                ? "Filled"
                : state.code === "expired"
                ? "Expired"
                : actionLabel}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * Job Details Modal / Sheet with responsibilities, compensation, schedule,
 * conditions, terms, and application/status handling.
 */
export function JobDetailsModal({
  call,
  open,
  onClose,
  onApply,
  applying = false,
  applyError = "",
  hasActiveContract = false,
  energyCapReached = false,
}) {
  if (!call) return null;
  const cat = categoryForSkill(call.skill);
  const state = getJobCallState(call, { hasActiveContract, energyCapReached });
  const clientName = call.client || call.business_name || (call.vendor_handle ? `@${call.vendor_handle}` : "Verified Business");
  const xpEstimate = Math.max(10, Math.floor(Number(call.pay_kes || 0) / 10));
  const goldEstimate = Math.max(5, Math.floor(Number(call.pay_kes || 0) * 0.1));

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={call.title}
      description={`${cat.title} · Posted by ${clientName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {state.code !== "mine" && (
            <Button
              disabled={!state.canApply || applying}
              loading={applying}
              onClick={() => onApply?.(call)}
            >
              {state.canApply ? `Apply · KES ${num(call.pay_kes)}` : state.label}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {/* Status Banner */}
        <div className="flex items-center justify-between gap-2 rounded-xl border border-edge-1 bg-surface-1 p-3">
          <div className="flex items-center gap-2.5">
            <Avatar name={clientName} size="sm" />
            <div>
              <p className="text-xs font-semibold text-ink-1">{clientName}</p>
              <p className="text-micro text-ink-4">
                {call.location || "Market zone"}
                {typeof call.distance_km === "number" ? ` · ${call.distance_km} km away` : ""}
              </p>
            </div>
          </div>
          <Badge variant={state.badgeVariant} size="sm">
            {state.label}
          </Badge>
        </div>

        {/* Compensation & Schedule Grid */}
        <div className="grid sm:grid-cols-3 gap-2.5">
          <div className="rounded-xl border border-edge-1 bg-surface-1 p-3">
            <span className="text-micro uppercase tracking-wider font-bold text-ink-4">Compensation</span>
            <p className="text-base font-bold text-ink-1 tabular-nums mt-0.5">KES {num(call.pay_kes)}</p>
            <p className="text-micro text-brand-700 dark:text-brand-300 mt-0.5">
              +{xpEstimate} XP · +{goldEstimate} Gold bonus
            </p>
          </div>
          <div className="rounded-xl border border-edge-1 bg-surface-1 p-3">
            <span className="text-micro uppercase tracking-wider font-bold text-ink-4">Schedule &amp; Window</span>
            <p className="text-xs font-bold text-ink-1 mt-0.5">
              {call.expires_at ? `Closes ${shortDate(call.expires_at)}` : "Immediate start"}
            </p>
            <p className="text-micro text-ink-4 mt-0.5">
              {call.expires_at ? relativeTime(call.expires_at) : "Single shift"}
            </p>
          </div>
          <div className="rounded-xl border border-edge-1 bg-surface-1 p-3">
            <span className="text-micro uppercase tracking-wider font-bold text-ink-4">Requirements</span>
            <p className="text-xs font-bold text-ink-1 capitalize mt-0.5">
              {call.required_tier || "Common"} skill card
            </p>
            <p className="text-micro text-ink-4 mt-0.5">
              {call.squad_id ? "Squad team shift" : "Individual shift"}
            </p>
          </div>
        </div>

        {/* Responsibilities & Conditions */}
        <div className="rounded-xl border border-edge-1 bg-surface-0 p-3.5 space-y-2">
          <h4 className="text-xs font-semibold text-ink-1">Responsibilities &amp; scope</h4>
          <p className="text-xs text-ink-2 leading-relaxed">
            {call.description ||
              `${cat.title} assignment (${call.title}) at ${call.location || "the client's business premises"}. Report on time, complete the agreed ${cat.shortLabel.toLowerCase()} tasks with the client supervisor, and verify completion on site.`}
          </p>
        </div>

        {/* Commercial & Verification Terms */}
        <div className="rounded-xl border border-edge-1 bg-surface-1 p-3.5 space-y-1.5 text-2xs text-ink-3">
          <h4 className="text-xs font-semibold text-ink-1">Completion &amp; payment terms</h4>
          <ul className="space-y-1 list-disc list-inside">
            <li>Agreed rate of <strong>KES {num(call.pay_kes)}</strong> is locked when you accept the contract.</li>
            <li>Client receives a 6-digit completion OTP code when the shift is accepted.</li>
            <li>Enter the client&apos;s 6-digit OTP at the end of the shift to record completion and unlock XP &amp; Gold.</li>
            {call.mine && call.otp_code && (
              <li className="text-brand-700 dark:text-brand-300 font-mono font-semibold">
                Your client completion OTP: {call.otp_code}
              </li>
            )}
          </ul>
        </div>

        {state.reason && (
          <div className="rounded-xl border border-accent-200 dark:border-accent-800 bg-accent-50 dark:bg-surface-2 p-3 text-xs text-accent-800 dark:text-accent-300 flex items-start gap-2">
            <Lock size={14} className="shrink-0 mt-0.5" />
            <span>{state.reason}</span>
          </div>
        )}

        {applyError && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-surface-2 p-3 text-xs text-red-700 dark:text-red-300 flex items-start gap-2"
          >
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{applyError}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * Post a Temporary Job Modal backed by `squadAPI.postCall`.
 */
export function PostJobModal({ open, onClose, onPosted, defaultLocation = "" }) {
  const [form, setForm] = useState({
    title: "",
    skill: "cleaner",
    required_tier: "common",
    pay_kes: "350",
    location: defaultLocation,
    hours_open: "24",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const activeCategory = categoryForSkill(form.skill);

  const submit = async (e) => {
    e.preventDefault();
    if (form.title.trim().length < 4) {
      setError("Enter a clear job title (at least 4 characters).");
      return;
    }
    const pay = Number(form.pay_kes);
    if (!pay || pay < activeCategory.minWage) {
      setError(`Minimum fair pay for ${activeCategory.title} is KES ${activeCategory.minWage}.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { data } = await squadAPI.postCall({
        title: form.title.trim(),
        skill: form.skill,
        task_type: form.skill,
        required_tier: form.required_tier,
        pay_kes: pay,
        location: form.location.trim() || null,
        hours_open: Number(form.hours_open) || 24,
      });
      toast.success("Temporary job posted");
      onPosted?.(data);
      onClose?.();
    } catch (err) {
      setError(apiError(err, "Could not post the job call"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Post a temporary job"
      description="Publish a paid shift with a guaranteed minimum rate and two-party OTP completion."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={busy}>
            Post Job
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3.5">
        <Input
          label="Job title"
          required
          placeholder="e.g. Offload 40 sacks & stack bay B"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          autoFocus
        />
        <div className="grid sm:grid-cols-2 gap-3">
          <Select
            label="Work category"
            value={form.skill}
            onChange={(e) => {
              const cat = categoryForSkill(e.target.value);
              setForm((f) => ({
                ...f,
                skill: e.target.value,
                pay_kes: String(Math.max(Number(f.pay_kes) || 0, cat.minWage)),
              }));
            }}
            options={JOB_CATEGORIES.map((c) => ({
              value: c.skill,
              label: `${c.title} (min KES ${c.minWage})`,
            }))}
          />
          <Input
            label={`Pay rate (min KES ${activeCategory.minWage})`}
            type="number"
            min={activeCategory.minWage}
            prefix="KES"
            required
            value={form.pay_kes}
            onChange={(e) => setForm({ ...form, pay_kes: e.target.value })}
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Input
            label="Location / Market"
            placeholder="e.g. Wakulima Market, Stall 14"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
          />
          <Select
            label="Required worker tier"
            value={form.required_tier}
            onChange={(e) => setForm({ ...form, required_tier: e.target.value })}
            options={[
              { value: "common", label: "Common (Open to all verified workers)" },
              { value: "rare", label: "Rare (10+ completed shifts, 4.0★+)" },
              { value: "epic", label: "Epic (30+ completed shifts, 4.3★+)" },
              { value: "legendary", label: "Legendary (75+ shifts, 4.5★+)" },
            ]}
          />
        </div>
        {error && (
          <p role="alert" className="rounded-xl bg-red-50 dark:bg-surface-2 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
