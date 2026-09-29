import { useEffect, useState } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { ArrowRight, AtSign, Lock, Mail, Store, MapPin, Phone } from "lucide-react";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { useAuthStore } from "@/stores/authStore";
import { apiError } from "@/lib/api";
import { slugify, splitList, cn } from "@/lib/utils";

const PILLARS = [
  ["Stock, not listings", "Your shelf is live. Other vendors source from it; nobody browses it like a shop."],
  ["Parasitism index", "The network scores how much you give back. Symbiotic vendors get seen first."],
  ["Patrons & lists", "Run curated vendor lists, gate them with criteria, and organise events around them."],
];

export default function AuthPage() {
  const [params, setParams] = useSearchParams();
  const mode = params.get("mode") === "register" ? "register" : "login";
  const navigate = useNavigate();
  const location = useLocation();
  const { login, register, loading, token } = useAuthStore();
  const [form, setForm] = useState({ identifier: "", password: "", business_name: "", vendor_handle: "", email: "", phone: "", categories: "", physical_location: "", business_description: "" });
  const [handleTouched, setHandleTouched] = useState(false);
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
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr] bg-surface-0">
      <section className="hidden lg:flex flex-col justify-between p-12 border-r border-edge-1 bg-surface-1 relative overflow-hidden">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-brand-600/10 blur-3xl" />
        <div className="relative flex items-center gap-2">
          <span className="font-mono text-2xl font-bold text-brand-400">B_</span>
          <span className="text-sm text-ink-3">Brief_ · vendor network</span>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-4xl font-bold tracking-tight text-ink-1 leading-tight">
            No consumers.
            <br />
            <span className="text-brand-400">Only vendors.</span>
          </h1>
          <p className="mt-4 text-sm text-ink-3 leading-relaxed">
            A closed trade network for the people who actually move goods — mama mbogas, kibandas, wholesalers, couriers. Source from each other, keep your shelf live from your till, and build a reputation the network can measure.
          </p>
          <ul className="mt-8 space-y-4">
            {PILLARS.map(([t, d]) => (
              <li key={t} className="flex gap-3">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-brand-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-ink-1">{t}</p>
                  <p className="text-xs text-ink-4 leading-relaxed">{d}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-2xs text-ink-4 font-mono">Nairobi · {new Date().getFullYear()}</p>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md animate-slide-up">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <span className="font-mono text-2xl font-bold text-brand-400">B_</span>
            <span className="text-sm text-ink-3">Brief_ · vendor network</span>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-surface-1 border border-edge-1 w-fit mb-6" role="tablist">
            {["login", "register"].map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => switchMode(m)} className={cn("px-4 h-8 rounded-md text-sm font-medium transition-colors", mode === m ? "bg-surface-3 text-ink-1" : "text-ink-4 hover:text-ink-2")}>
                {m === "login" ? "Enter" : "Join"}
              </button>
            ))}
          </div>

          <h2 className="text-xl font-semibold text-ink-1">{mode === "login" ? "Enter the network" : "Register your business"}</h2>
          <p className="text-sm text-ink-4 mt-1 mb-6">{mode === "login" ? "Use your email or @handle." : "One account per business. You choose your role afterwards."}</p>

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
                  hint="Lowercase letters, numbers and underscores"
                />
                <div className="grid sm:grid-cols-2 gap-3">
                  <Input label="Email" icon={Mail} type="email" required autoComplete="email" value={form.email} onChange={set("email")} />
                  <Input label="Phone" icon={Phone} value={form.phone} onChange={set("phone")} placeholder="+2547…" />
                </div>
                <Input label="Password" icon={Lock} type="password" required autoComplete="new-password" minLength={8} value={form.password} onChange={set("password")} hint="At least 8 characters" />
                <div className="grid sm:grid-cols-2 gap-3">
                  <Input label="What you trade" value={form.categories} onChange={set("categories")} placeholder="vegetables, fruit" hint="Comma separated" />
                  <Input label="Where" icon={MapPin} value={form.physical_location} onChange={set("physical_location")} placeholder="Kawangware" />
                </div>
                <Textarea label="About the business" rows={2} value={form.business_description} onChange={set("business_description")} />
              </>
            )}
            <Button type="submit" size="lg" fullWidth loading={loading} iconRight={ArrowRight}>
              {mode === "login" ? "Enter" : "Join the network"}
            </Button>
          </form>

          <p className="mt-6 text-xs text-ink-4 text-center">
            {mode === "login" ? "New business? " : "Already registered? "}
            <button onClick={() => switchMode(mode === "login" ? "register" : "login")} className="text-brand-400 hover:text-brand-300 font-medium">
              {mode === "login" ? "Join the network" : "Enter"}
            </button>
          </p>
        </div>
      </section>
    </div>
  );
}
