import { useEffect, useState } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import {
  ArrowRight, AtSign, Building2, ChevronDown, Hammer, Home, Lock, Mail,
  MapPin, Phone, Receipt, Shield, Store, UserRound,
} from "lucide-react";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { LogoMark } from "@/components/layout/Logo";
import { useAuthStore } from "@/stores/authStore";
import { apiError } from "@/lib/api";
import { ACCOUNT_KINDS } from "@/lib/inference";
import { slugify, splitList, cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════════════════
   AUTH — Inclusive participation for people, households, artisans,
          institutions, and optional businesses.
   ---------------------------------------------------------------------------
   Non-vendor participation is the default (`account_kind = "person"`):
   residents, households, travelling fundis, and community groups can join,
   publish Available / Wanted / Scheduled / Opportunity activities, and book
   directly without creating a shop or storefront. Full business tools remain
   optional and backward-compatible.
   ═══════════════════════════════════════════════════════════════════════════ */

const LOOP = [
  {
    icon: Home,
    title: "Post as a person, household, artisan, or business",
    body: "Offer a skill, ask for a fence repair, schedule a cobbler round, or pool a fodder order — no storefront required.",
  },
  {
    icon: Shield,
    title: "Approximate neighbourhood by default",
    body: "Exact gate or homestead directions stay private and unlock only for the agreed booking window, then re-lock after completion.",
  },
  {
    icon: Receipt,
    title: "Non-custodial bookings & reusable records",
    body: "Settle directly in cash, M-Pesa, or in-kind. Mutual completion creates a private reusable record while keeping local alternatives visible.",
  },
];

const KIND_ICONS = {
  person: UserRound,
  household: Home,
  artisan: Hammer,
  institution: Building2,
  business: Store,
};

export default function AuthPage() {
  const [params, setParams] = useSearchParams();
  const mode = params.get("mode") === "register" ? "register" : "login";
  const navigate = useNavigate();
  const location = useLocation();
  const { login, register, loading, token } = useAuthStore();
  const [form, setForm] = useState({
    identifier: "",
    password: "",
    account_kind: "person",
    business_name: "",
    vendor_handle: "",
    email: "",
    phone: "",
    categories: "",
    physical_location: "",
    business_description: "",
    hide_exact_location: true,
  });
  const [handleTouched, setHandleTouched] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const from = location.state?.from || "/";

  useEffect(() => {
    if (token) navigate(from, { replace: true });
  }, [token, from, navigate]);

  const set = (k) => (e) => {
    const v = e.target.value;
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === "business_name" && !handleTouched) next.vendor_handle = slugify(v);
      return next;
    });
  };

  const selectAccountKind = (kindValue) => {
    const meta = ACCOUNT_KINDS.find((k) => k.value === kindValue) || ACCOUNT_KINDS[0];
    setForm((f) => ({
      ...f,
      account_kind: kindValue,
      hide_exact_location: meta.defaultPrivateLocation,
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (mode === "login") {
        await login(form.identifier.trim(), form.password);
        toast.success("Welcome back");
      } else {
        if (!/^[a-z0-9_]{3,30}$/.test(form.vendor_handle)) return toast.error("Handle: 3–30 lowercase letters, numbers or _");
        if (form.password.length < 8) return toast.error("Password needs at least 8 characters");
        const cleanName = form.business_name.trim();
        await register({
          account_kind: form.account_kind,
          display_name: cleanName,
          business_name: cleanName,
          vendor_handle: form.vendor_handle,
          email: form.email.trim(),
          password: form.password,
          phone: form.phone.trim() || null,
          business_categories: splitList(form.categories),
          physical_location: form.physical_location.trim() || null,
          business_description: form.business_description.trim() || null,
          hide_exact_location: Boolean(form.hide_exact_location),
        });
        toast.success(`@${form.vendor_handle} is ready`);
      }
    } catch (err) {
      toast.error(apiError(err, mode === "login" ? "Couldn't sign in" : "Couldn't register"));
    }
  };

  const switchMode = (m) => setParams(m === "register" ? { mode: "register" } : {}, { replace: true });
  const selectedKind = ACCOUNT_KINDS.find((k) => k.value === form.account_kind) || ACCOUNT_KINDS[0];
  const namePlaceholder = {
    person: "Wanjiku Mwangi",
    household: "Nyanchwa Homestead",
    artisan: "Juma Fence & Timber Works",
    institution: "Kondele Youth Learning Hub",
    business: "Mama Mboga Fresh",
  }[form.account_kind] || "Wanjiku Mwangi";

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr] bg-surface-0">
      {/* ══ the pitch: local activity ledger for everyone ══════════════ */}
      <section className="hidden lg:flex flex-col justify-between p-12 relative overflow-hidden bg-surface-1 border-r border-edge-1">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(720px 320px at 0% -10%, rgb(var(--brand-500) / 0.12), transparent 60%), radial-gradient(520px 280px at 100% 100%, rgb(var(--accent-500) / 0.10), transparent 60%)",
          }}
          aria-hidden="true"
        />
        <div className="relative flex items-center gap-2.5">
          <LogoMark size={36} />
          <span className="text-base font-extrabold tracking-tight text-ink-1">ogallo</span>
          <span className="text-2xs text-ink-4 border-l border-edge-2 pl-2.5">neighbourhood activity & local trade</span>
        </div>

        <div className="relative max-w-lg">
          <h1 className="text-4xl font-extrabold tracking-tight text-ink-1 leading-[1.1] text-balance">
            Arrange local help, repairs, rounds & trade with records you can <span className="text-brand-600 dark:text-brand-400">actually trust</span>.
          </h1>
          <p className="mt-4 text-sm text-ink-3 leading-relaxed text-pretty">
            For neighbours, households, fundis, community groups, and local businesses alike. Post what is Available, Wanted, Scheduled, or an Opportunity — without needing a shopfront to participate.
          </p>
          <ol className="mt-9 space-y-5">
            {LOOP.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="flex gap-3.5">
                <span className="mt-0.5 w-9 h-9 rounded-xl bg-surface-0 border border-edge-1 grid place-items-center text-brand-600 dark:text-brand-400 shrink-0">
                  <Icon size={17} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-ink-1">
                    <span className="text-ink-4 font-mono mr-1.5">{i + 1}</span>
                    {title}
                  </p>
                  <p className="text-2xs text-ink-3 leading-relaxed mt-0.5">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <p className="relative text-micro text-ink-4">
          People · households · artisans · institutions · businesses · {new Date().getFullYear()}
        </p>
      </section>

      {/* ══ the form ══════════════════════════════════════════════════ */}
      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md animate-fade-in">
          <div className="lg:hidden mb-8 flex items-center gap-2.5">
            <LogoMark size={34} />
            <span className="text-base font-extrabold tracking-tight text-ink-1">ogallo</span>
            <span className="text-micro text-ink-4 border-l border-edge-2 pl-2.5">neighbourhood activity & trade</span>
          </div>

          <div className="rounded-3xl border border-edge-1 bg-surface-0 shadow-sm p-6 sm:p-7">
            <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-2 w-fit mb-6" role="tablist">
              {["login", "register"].map((m) => (
                <button
                  key={m}
                  role="tab"
                  type="button"
                  aria-selected={mode === m}
                  onClick={() => switchMode(m)}
                  className={cn(
                    "px-4 h-8 rounded-lg text-xs font-semibold transition-colors duration-1",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50",
                    mode === m ? "bg-surface-0 text-ink-1 shadow-xs" : "text-ink-4 hover:text-ink-2"
                  )}
                >
                  {m === "login" ? "Enter" : "Join"}
                </button>
              ))}
            </div>

            <h2 className="text-xl font-bold text-ink-1 tracking-tight">
              {mode === "login"
                ? "Enter the network"
                : "Join as a neighbour, household, artisan — or register your business"}
            </h2>
            <p className="text-2xs text-ink-3 mt-1 mb-6">
              {mode === "login"
                ? "Use your email or @handle."
                : "No storefront required. Pick how you're joining — you can add optional shop tools anytime."}
            </p>

            <form onSubmit={submit} className="space-y-4">
              {mode === "login" ? (
                <>
                  <Input label="Email or handle" icon={AtSign} required autoFocus autoComplete="username" value={form.identifier} onChange={set("identifier")} placeholder="mama_mboga" />
                  <Input label="Password" icon={Lock} type="password" required autoComplete="current-password" value={form.password} onChange={set("password")} />
                </>
              ) : (
                <>
                  {/* Inclusive participation kind selector — defaults to `person` */}
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-ink-2">Joining as</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5" role="radiogroup" aria-label="Account kind">
                      {ACCOUNT_KINDS.map((kind) => {
                        const Icon = KIND_ICONS[kind.value] || UserRound;
                        const active = form.account_kind === kind.value;
                        return (
                          <button
                            key={kind.value}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            data-testid={`account-kind-${kind.value}`}
                            onClick={() => selectAccountKind(kind.value)}
                            className={cn(
                              "flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-left text-2xs font-semibold transition-colors",
                              active
                                ? "border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-200"
                                : "border-edge-1 bg-surface-1 text-ink-3 hover:border-edge-2"
                            )}
                          >
                            <Icon size={13} className="shrink-0" aria-hidden="true" />
                            <span className="truncate">{kind.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-micro text-ink-4" data-testid="account-kind-hint">
                      {selectedKind.hint}
                    </p>
                  </div>

                  <Input
                    label="Your name, household, or business name"
                    icon={KIND_ICONS[form.account_kind] || UserRound}
                    required
                    autoFocus
                    value={form.business_name}
                    onChange={set("business_name")}
                    placeholder={namePlaceholder}
                  />
                  <Input
                    label="Handle"
                    prefix="@"
                    required
                    value={form.vendor_handle}
                    onChange={(e) => {
                      setHandleTouched(true);
                      setForm((f) => ({ ...f, vendor_handle: slugify(e.target.value) }));
                    }}
                    className="font-mono"
                    hint="How neighbours address you. Lowercase letters, numbers and underscores."
                  />
                  <Input label="Email" icon={Mail} type="email" required autoComplete="email" value={form.email} onChange={set("email")} />
                  <Input label="Password" icon={Lock} type="password" required autoComplete="new-password" minLength={8} value={form.password} onChange={set("password")} hint="At least 8 characters" />

                  <label className="flex items-start gap-2.5 rounded-xl border border-edge-1 bg-surface-1 p-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(form.hide_exact_location)}
                      onChange={(e) => setForm((f) => ({ ...f, hide_exact_location: e.target.checked }))}
                      data-testid="auth-hide-exact-location"
                      className="mt-0.5 h-4 w-4 rounded border-edge-2 text-brand-600 focus:ring-brand-500"
                    />
                    <span className="text-2xs leading-relaxed text-ink-3">
                      <strong className="font-semibold text-ink-1">Keep my exact home location private</strong> — show only my general neighbourhood publicly and share gate directions solely during an agreed booking.
                    </span>
                  </label>

                  {/* Optional neighbourhood & optional storefront details */}
                  <div className="rounded-xl border border-edge-1 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setMoreOpen((v) => !v)}
                      aria-expanded={moreOpen}
                      className="w-full flex items-center justify-between gap-3 px-3.5 py-3 text-left hover:bg-surface-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                    >
                      <span className="min-w-0">
                        <span className="block text-2xs font-bold text-ink-1">
                          Neighbourhood, skills, or optional shop details
                        </span>
                        <span className="block text-micro text-ink-4">
                          Optional — helps match nearby activities and trusted neighbours.
                        </span>
                      </span>
                      <ChevronDown size={16} className={cn("text-ink-4 shrink-0 transition-transform duration-1", moreOpen && "rotate-180")} aria-hidden="true" />
                    </button>
                    {moreOpen && (
                      <div className="px-3.5 pb-3.5 pt-1 space-y-3 border-t border-edge-1">
                        <div className="grid sm:grid-cols-2 gap-3">
                          <Input label="Neighbourhood / town" icon={MapPin} value={form.physical_location} onChange={set("physical_location")} placeholder="Kisii, Muthaiga, Kondele…" />
                          <Input label="Skills or interests" value={form.categories} onChange={set("categories")} placeholder="repairs, fodder, cobbler" hint="Comma separated" />
                        </div>
                        <Input label="Phone" icon={Phone} value={form.phone} onChange={set("phone")} placeholder="+2547…" />
                        <Textarea label="Short note (optional)" rows={2} value={form.business_description} onChange={set("business_description")} />
                      </div>
                    )}
                  </div>
                </>
              )}

              <Button type="submit" size="lg" fullWidth loading={loading} iconRight={ArrowRight}>
                {mode === "login" ? "Enter" : "Join the network"}
              </Button>
            </form>

            {mode === "login" && (
              <p className="mt-4 text-2xs text-ink-3 text-center bg-surface-2 rounded-xl px-3 py-2.5">
                Demo network: <span className="font-mono text-ink-1">@mama_mboga</span> ·{" "}
                <span className="font-mono text-ink-1">Brief-demo-2026</span>
              </p>
            )}
          </div>

          <p className="mt-6 text-2xs text-ink-4 text-center">
            {mode === "login" ? "New here? " : "Already registered? "}
            <button
              type="button"
              onClick={() => switchMode(mode === "login" ? "register" : "login")}
              className="text-brand-700 dark:text-brand-400 font-semibold hover:underline underline-offset-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
            >
              {mode === "login" ? "Join the network" : "Enter"}
            </button>
          </p>
        </div>
      </section>
    </div>
  );
}
