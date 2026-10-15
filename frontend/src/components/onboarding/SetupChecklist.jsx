import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Circle, X } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useStockStore } from "@/stores/stockStore";
import { vendorAPI } from "@/lib/api";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════════════════
   FIRST-RUN SETUP — the one piece of onboarding this product needs.
   ---------------------------------------------------------------------------
   Not a tour, not a modal, not a slideshow. Four steps that each correspond to
   a real row in the database, read from endpoints the app already calls:

     1  describe the business   vendors/me            (categories)
     2  put stock on the shelf  stock/my-stock        (visible_to_network)
     3  meet suppliers          vendors/connections
     4  run the loop once       stock/movements

   Completed steps disappear as the vendor trades. Once finished — or dismissed —
   the compact checklist becomes a live business pulse. Nothing blocks the app.
   ═══════════════════════════════════════════════════════════════════════════ */

const KEY = (handle) => `brief-setup-done:${handle || "anon"}`;

export default function SetupChecklist({ className }) {
  const vendor = useAuthStore((s) => s.vendor);
  const mine = useStockStore((s) => s.mine);
  const movements = useStockStore((s) => s.movements);
  const fetchMine = useStockStore((s) => s.fetchMine);
  const shelfLoaded = useStockStore((s) => s.mineLoaded);
  const [connections, setConnections] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(KEY(vendor?.vendor_handle)) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let live = true;
    // A shelf already read (by the shop summary, or earlier in this session) is
    // not read again — an empty shelf is still an answer.
    if (!mine.length && !shelfLoaded) fetchMine?.().catch(() => {});
    (async () => {
      try {
        const { data } = await vendorAPI.connections();
        if (live) setConnections(Array.isArray(data) ? data.length : data?.connections?.length ?? 0);
      } catch {
        if (live) setConnections(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [fetchMine, mine.length, shelfLoaded]);

  const steps = useMemo(() => {
    const visible = mine.filter((i) => i.visible_to_network).length;
    return [
      {
        id: "profile",
        done: (vendor?.business_categories?.length || 0) > 0,
        title: "Say what you trade",
        body: "Categories are how the network matches you with suppliers and buyers.",
        to: `/@${vendor?.vendor_handle}?edit=1`,
        cta: "Edit profile",
      },
      {
        id: "stock",
        done: visible > 0,
        title: "Put one item on the shelf",
        body: "Mark it visible and other vendors can source it straight away. Items are private until you do.",
        to: "/stock",
        cta: "Add stock",
      },
      {
        id: "connect",
        done: (connections ?? 0) > 0,
        title: "Connect with a supplier",
        body: "Connections unlock trading preferences and put their shelf in front of you first.",
        to: "/network",
        cta: "Find suppliers",
      },
      {
        id: "loop",
        done: movements.length > 0,
        title: "Run the loop once",
        body: "Source something small. A completed movement is what starts your fulfilment record.",
        to: "/browse",
        cta: "Browse stock",
      },
    ];
  }, [vendor, mine, connections, movements]);

  const done = steps.filter((s) => s.done).length;
  const complete = done === steps.length;

  useEffect(() => {
    if (complete && vendor?.vendor_handle) {
      try {
        localStorage.setItem(KEY(vendor.vendor_handle), "1");
      } catch {
        /* storage is not available — the checklist simply returns next visit */
      }
    }
  }, [complete, vendor]);

  // Completed or dismissed: this component has nothing left to say. The live
  // business read it used to fall back to is `components/home/BusinessPulse`,
  // which belongs to the home screen's business band — not to onboarding.
  if (dismissed || complete) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY(vendor?.vendor_handle), "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <section
      aria-labelledby="setup-heading"
      className={cn("rounded-3xl border border-edge-1 bg-surface-1 p-5 sm:p-6 relative", className)}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss setup checklist"
        className="absolute top-4 right-4 w-7 h-7 grid place-items-center rounded-lg text-ink-4 hover:text-ink-1 hover:bg-surface-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
      >
        <X size={15} aria-hidden="true" />
      </button>

      <div className="flex flex-wrap items-center gap-3 pr-8">
        <h2 id="setup-heading" className="text-base font-bold text-ink-1 tracking-tight">
          Get trading
        </h2>
        <span className="text-2xs font-bold text-ink-3 tabular-nums">
          {done} of {steps.length}
        </span>
        <div className="h-1.5 flex-1 min-w-[6rem] max-w-[14rem] rounded-full bg-surface-3 overflow-hidden" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={steps.length}>
          <div className="h-full rounded-full bg-brand-500 transition-[width] duration-3 ease-out" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
      </div>

      <ol className="mt-3 grid sm:grid-cols-2 gap-x-6">
        {steps.filter((step) => !step.done).map((step) => (
          <li key={step.id} className="flex items-start gap-3 border-t border-edge-1 py-3">
            <Circle size={15} className="mt-0.5 shrink-0 text-ink-4" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-ink-1">{step.title}</p>
              <p className="text-micro text-ink-3 mt-0.5 leading-relaxed">{step.body}</p>
              <Link
                to={step.to}
                className="mt-1.5 inline-flex items-center gap-1 text-micro font-bold text-brand-700 dark:text-brand-400 hover:underline underline-offset-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
              >
                {step.cta}
                <ArrowRight size={12} aria-hidden="true" />
              </Link>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
