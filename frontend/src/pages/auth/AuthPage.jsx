import { useEffect, useState } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { ArrowRight, AtSign, ChevronDown, Lock, Mail, MapPin, Phone, Receipt, Store, Truck } from "lucide-react";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { LogoMark } from "@/components/layout/Logo";
import { useAuthStore } from "@/stores/authStore";
import { apiError } from "@/lib/api";
import { slugify, splitList, cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════════════════
   AUTH — the first screen, and the only one a non-member ever sees.
   ---------------------------------------------------------------------------
   WHAT CHANGED   The pitch panel now explains the LOOP (publish → source →
                  deliver → the record follows you) instead of listing three
                  features, and the form groups the eight registration fields
                  into "the account" and "what you trade", the second of which
                  is collapsed by default.
   WHY            Eight required-looking fields is the single biggest drop-off
                  in a B2B signup. Only four are actually needed; the rest
                  improve suggestions and can be filled in later from the shop
                  front.
   PRESERVED      Exactly the same payload to POST /auth/register, the same
                  client-side validation (handle pattern, 8-char password),
                  the same auto-slug from business name, the same login by
                  email OR handle, the same demo-credentials hint, and the
                  same ?mode=register deep link.
   ═══════════════════════════════════════════════════════════════════════════ */

const LOOP = [
  { icon: Store, title: "Put your shelf on the network", body: "What you already have in stock becomes sourceable the moment you mark it visible. No listings to write." },
  { icon: Truck, title: "Source in two taps", body: "Request a quantity from another vendor. Stock is reserved, the movement runs requested → confirmed → shipped → received." },
  { icon: Receipt, title: "The record follows you", body: "Every completed movement updates your fulfilment rate and network score. Nobody types their own reputation here." },
];

export default function AuthPage() {
  const [params, setParams] = useSearchParams();
  const mode = params.get("mode") === "register" ? "register" : "login";
  const navigate = useNavigate();
  const location = useLocation();
  const { login, register, loading, token } = useAuthStore();
  const [form, setForm] = useState({
    identifier: "", password: "", business_name: "", vendor_handle: "", email: "",
    phone: "", categories: "", physical_location: "", business_description: "",
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

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (mode === "login") {
        await login(form.identifier.trim(), form.password);
        toast.success("Welcome back to the network");
      } else {
        if (!/^[a-z0-9_]{3,30}$/.test(form.vendor_handle)) return toast.error("Handle: 3–30 lowercase letters, numbers or _");
        if (form.password.length < 8) return toast.error("Password needs at least 8 characters");
        await register({
          business_name: form.business_name.trim(),
          vendor_handle: form.vendor_handle,
          email: form.email.trim(),
          password: form.password,
          phone: form.phone.trim() || null,
          business_categories: splitList(form.categories),
          physical_location: form.physical_location.trim() || null,
          business_description: form.business_description.trim() || null,
        });
        toast.success(`@${form.vendor_handle} is on the network`);
      }
    } catch (err) {
      toast.error(apiError(err, mode === "login" ? "Couldn't sign in" : "Couldn't register"));
    }
  };

  const switchMode = (m) => setParams(m === "register" ? { mode: "register" } : {}, { replace: true });

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr] bg-surface-0">
      {/* ══ the pitch: what this network is, in one loop ══════════════ */}
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
          <span className="text-base font-extrabold tracking-tight text-ink-1">brief</span>
          <span className="text-2xs text-ink-4 border-l border-edge-2 pl-2.5">the trade network with receipts</span>
        </div>

        <div className="relative max-w-lg">
          <h1 className="text-4xl font-extrabold tracking-tight text-ink-1 leading-[1.1] text-balance">
            Source from vendors whose record you can <span className="text-brand-600 dark:text-brand-400">actually see</span>.
          </h1>
          <p className="mt-4 text-sm text-ink-3 leading-relaxed text-pretty">
            Brief is for businesses that already buy from each other — market traders, kiosks, kitchens, wholesalers. Every price here is
            stated by a vendor and timestamped. Every fulfilment rate is computed from movements that actually completed.
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
          Vendor accounts only · one account per business · Nairobi · {new Date().getFullYear()}
        </p>
      </section>

      {/* ══ the form ══════════════════════════════════════════════════ */}
      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md animate-fade-in">
          <div className="lg:hidden mb-8 flex items-center gap-2.5">
            <LogoMark size={34} />
            <span className="text-base font-extrabold tracking-tight text-ink-1">brief</span>
            <span className="text-micro text-ink-4 border-l border-edge-2 pl-2.5">the trade network with receipts</span>
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
              {mode === "login" ? "Enter the network" : "Register your business"}
            </h2>
            <p className="text-2xs text-ink-3 mt-1 mb-6">
              {mode === "login"
                ? "Use your email or @handle."
                : "Four fields to start trading. You pick your role, and everything else, afterwards."}
            </p>

            <form onSubmit={submit} className="space-y-4">
              {mode === "login" ? (
                <>
                  <Input label="Email or handle" icon={AtSign} required autoFocus autoComplete="username" value={form.identifier} onChange={set("identifier")} placeholder="mama_mboga" />
                  <Input label="Password" icon={Lock} type="password" required autoComplete="current-password" value={form.password} onChange={set("password")} />
                </>
              ) : (
                <>
                  <Input label="Business name" icon={Store} required autoFocus value={form.business_name} onChange={set("business_name")} placeholder="Mama Mboga Fresh" />
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
                    hint="How the network addresses you. Lowercase letters, numbers and underscores."
                  />
                  <Input label="Email" icon={Mail} type="email" required autoComplete="email" value={form.email} onChange={set("email")} />
                  <Input label="Password" icon={Lock} type="password" required autoComplete="new-password" minLength={8} value={form.password} onChange={set("password")} hint="At least 8 characters" />

                  {/* progressive disclosure: these four improve the network's
                      suggestions but have never been required by the API. */}
                  <div className="rounded-xl border border-edge-1 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setMoreOpen((v) => !v)}
                      aria-expanded={moreOpen}
                      className="w-full flex items-center justify-between gap-3 px-3.5 py-3 text-left hover:bg-surface-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                    >
                      <span className="min-w-0">
                        <span className="block text-2xs font-bold text-ink-1">Tell the network what you trade</span>
                        <span className="block text-micro text-ink-4">Optional — it is what drives supplier suggestions.</span>
                      </span>
                      <ChevronDown size={16} className={cn("text-ink-4 shrink-0 transition-transform duration-1", moreOpen && "rotate-180")} aria-hidden="true" />
                    </button>
                    {moreOpen && (
                      <div className="px-3.5 pb-3.5 pt-1 space-y-3 border-t border-edge-1">
                        <div className="grid sm:grid-cols-2 gap-3">
                          <Input label="What you trade" value={form.categories} onChange={set("categories")} placeholder="vegetables, fruit" hint="Comma separated" />
                          <Input label="Where" icon={MapPin} value={form.physical_location} onChange={set("physical_location")} placeholder="Kawangware" />
                        </div>
                        <Input label="Phone" icon={Phone} value={form.phone} onChange={set("phone")} placeholder="+2547…" />
                        <Textarea label="About the business" rows={2} value={form.business_description} onChange={set("business_description")} />
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
            {mode === "login" ? "New business? " : "Already registered? "}
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
