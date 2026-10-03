import { useCallback, useEffect, useState } from "react";
import { MapPin, Map, Compass, X, Check } from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import MarketRadar from "@/components/squad/MarketRadar";
import { onboardingAPI, vendorAPI, geoAPI, apiError } from "@/lib/api";
import { toast } from "@/components/ui/Toast";
import { num } from "@/lib/formatters";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// FIRST RUN — two screens, two ideas.
//
// 1. YOUR SHOP PAGE (the MySpace move): your profile is a public page others
//    open by handle. So the first thing you do is make the page real — a name,
//    what you trade, and a location the map can find. Completeness is a bar
//    over fields that exist, not a score that a badge could fake.
//
// 2. WALK YOUR MARKET (the Pokémon GO move): the app shows what is REAL
//    within 3 km — named suppliers, public places, open call-ups, rentals,
//    events — each with its true distance. You do one real thing per row:
//    connect, claim, accept. "Found" means a row was written.
//
// The flow shows while any onboarding step is open; it closes itself when the
// work is done, or stays closed once dismissed. It never pads itself.
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS = ["shop", "wholesale", "services", "rider", "fundi", "cook", "tutor", "digital", "other"];

const DISMISS_KEY = "squad.onboarding.dismissed";

export default function OnboardingFlow() {
  const [data, setData] = useState(null);
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);
  const [locText, setLocText] = useState("");
  const [cats, setCats] = useState([]);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    onboardingAPI.get().then((r) => {
      setData(r.data);
      const done = r.data.completion >= 1;
      const dismissed = (() => { try { return !!localStorage.getItem(DISMISS_KEY); } catch { return false; } })();
      setShow(!done && !dismissed);
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (data?.my_page?.location) setLocText(data.my_page.location);
    if (data?.my_page?.categories?.length) setCats(data.my_page.categories);
  }, [data]);

  if (!data || !show) return null;

  const step1Done = data.steps.find((s) => s.key === "located")?.done;
  const step2Done = data.steps.find((s) => s.key === "page")?.done;
  const activeStep = step1Done && step2Done ? 1 : 0;

  const locateAndSave = async () => {
    setLocating(true);
    try {
      let geo = null;
      if (locText.trim()) {
        try {
          const { data: g } = await geoAPI.geocode(locText.trim());
          geo = { lat: g.lat, lng: g.lng };
        } catch {
          toast.error(apiError(null, "No match for that place — try “Kawangware, Nairobi”"));
          return;
        }
      }
      const patch = { physical_location: locText.trim() || null };
      if (geo) { patch.geo_lat = geo.lat; patch.geo_lng = geo.lng; }
      if (cats.length) patch.business_categories = cats;
      await vendorAPI.update(patch);
      toast.success("Your shop page is on the map");
      load();
      setStep(1);
    } catch (e) {
      toast.error(apiError(e, "The page could not be saved"));
    } finally {
      setLocating(false);
    }
  };

  const saveCatsOnly = async () => {
    setSaving(true);
    try {
      await vendorAPI.update({ business_categories: cats });
      load();
    } catch (e) {
      toast.error(apiError(e, "Could not save"));
    } finally {
      setSaving(false);
    }
  };

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode */ }
    setShow(false);
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true" aria-label="Getting your shop on the map">
      <div className="w-full max-w-lg bg-surface-1 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <div className="flex items-center gap-2">
            {[0, 1].map((i) => (
              <span key={i} className={cn("h-1.5 rounded-full transition-all", (i === 0 && (step1Done || step2Done ? false : true)) || (i === 1 && activeStep === 1) ? "w-8 bg-brand-400" : "w-4 bg-white/[0.15]")} />
            ))}
            <span className="text-2xs text-ink-4 ml-2">{Math.round(data.completion * 100)}% of your first week</span>
          </div>
          <button type="button" onClick={dismiss} className="text-ink-4 hover:text-ink-2" aria-label="Dismiss">
            <X size={18} />
          </button>
        </div>

        {activeStep === 0 && (
          <div className="px-5 pb-6 space-y-4">
            <div>
              <p className="text-2xs uppercase tracking-[0.2em] text-brand-400 font-bold flex items-center gap-1.5"><Map size={13} /> Step 1 · Your shop page</p>
              <h3 className="text-xl font-semibold text-ink-1 mt-2 tracking-tight">This page is your face in the market</h3>
              <p className="text-xs text-ink-4 mt-1">Others open it by <span className="font-mono text-ink-3">@{data.my_page.handle}</span>. A name, what you trade, and where you are — that's the whole page. Nothing more is asked.</p>
            </div>

            <div className="glass rounded-2xl p-3.5 flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-brand-500/15 text-brand-300 flex items-center justify-center text-base font-bold">
                {(data.my_page.name || "?").charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-1 truncate">{data.my_page.name}</p>
                <p className="text-2xs text-ink-4 font-mono">@{data.my_page.handle}</p>
              </div>
              <div className="ml-auto w-20">
                <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-brand-500 to-brand-300" style={{ width: `${Math.round(data.completion * 100)}%` }} />
                </div>
                <p className="text-2xs text-ink-4 mt-1 text-right">{Math.round(data.completion * 100)}%</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <Input
                label="Where do you trade?"
                value={locText}
                onChange={(e) => setLocText(e.target.value)}
                placeholder="Gikomba, Nairobi"
                wrapperClassName="flex-1"
              />
            </div>

            <div>
              <p className="text-xs font-medium text-ink-3 mb-1.5">What you trade (tap all that apply)</p>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORY_OPTIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCats((m) => m.includes(c) ? m.filter((x) => x !== c) : [...m, c])}
                    className={cn("rounded-full px-3 h-8 text-xs font-medium capitalize transition-colors", cats.includes(c) ? "bg-brand-500/25 text-brand-200" : "bg-white/[0.05] text-ink-3 hover:text-ink-1")}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button loading={locating || saving} onClick={locateAndSave} className="flex-1 justify-center" icon={MapPin}>
                Put me on the map
              </Button>
              <Button variant="ghost" onClick={saveCatsOnly} disabled={!cats.length}>Save</Button>
            </div>
          </div>
        )}

        {activeStep === 1 && (
          <div className="px-5 pb-6 space-y-4">
            <div>
              <p className="text-2xs uppercase tracking-[0.2em] text-brand-400 font-bold flex items-center gap-1.5"><Compass size={13} /> Step 2 · Walk your market</p>
              <h3 className="text-xl font-semibold text-ink-1 mt-2 tracking-tight">Here is what's real within 3 km</h3>
              <p className="text-xs text-ink-4 mt-1">Not a feed — the actual market around your pin: named suppliers, public places, open call-ups. Do one real thing per row and it counts.</p>
            </div>
            <div className="glass rounded-2xl px-3.5">
              <MarketRadar nearby={data.nearby} onRefresh={load} />
            </div>
            <div className="flex items-center gap-2">
              {data.steps.filter((s) => s.done).length > 0 && (
                <p className="text-2xs text-ink-4 flex items-center gap-1"><Check size={11} className="text-brand-300" /> {data.steps.filter((s) => s.done).length} of {data.steps.length} first-week steps done</p>
              )}
              <Button variant="ghost" onClick={dismiss} className="ml-auto">Done for now</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
