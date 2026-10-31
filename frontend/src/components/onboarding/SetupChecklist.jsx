import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Circle, X } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useStockStore } from "@/stores/stockStore";
import { fileAPI, vendorAPI, apiError } from "@/lib/api";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════════════════
   FIRST-RUN SETUP — the one piece of onboarding this product needs.
   ---------------------------------------------------------------------------
   Not a tour, not a modal, not a slideshow. Steps that each correspond to a
   real row in the database, read from endpoints the app already calls.

   It leads with VITAL INFORMATION, because that is the part a business cannot
   afford to leave blank and the part a buyer judges it on:

     1  a photo on the shelf    stock/my-stock        (images[])
     2  a face for the shop     vendors/me/profile    (logo / gallery)
     3  a description           vendors/me            (business_description)
     4  say what you trade      vendors/me            (categories)

   …then the trading loop, which is what actually makes a business money:

     5  meet suppliers          vendors/connections
     6  run the loop once       stock/movements

   The vital half is hard-coded because it is not optional: the dismiss button
   does not appear until every one of those four is done. The trading half can
   be dismissed by someone who already knows their way around. Once everything
   is complete the whole card renders nothing at all.
   ═══════════════════════════════════════════════════════════════════════════ */

const KEY = (handle) => `brief-setup-done:${handle || "anon"}`;

export default function SetupChecklist({ className }) {
  const vendor = useAuthStore((s) => s.vendor);
  const mine = useStockStore((s) => s.mine);
  const movements = useStockStore((s) => s.movements);
  const fetchMine = useStockStore((s) => s.fetchMine);
  const shelfLoaded = useStockStore((s) => s.mineLoaded);
  const [connections, setConnections] = useState(null);
  // The profile carries the shop's photos, logo and description. Read lazily:
  // a vendor who never opens their own shop front still needs to be told here
  // that the face of their business is blank.
  const [profile, setProfile] = useState(null);
  // Photographs are pickable from here, not three taps away. The task that says
  // "put a face on the shop" opens the gallery picker on the same screen: a
  // task that only links elsewhere is a task people leave and forget.
  const galleryRef = useRef(null);
  const [uploading, setUploading] = useState(false);
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
        const { data: own } = await vendorAPI.profile();
        if (live) setProfile(own || {});
      } catch {
        if (live) setProfile({});
      }
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

  const gallery = useMemo(() => {
    const g = profile?.portfolio_images || profile?.supply_capacity?.gallery_photos;
    return Array.isArray(g) ? g.filter(Boolean) : [];
  }, [profile]);

  const addShopPhotos = async (event) => {
    const files = Array.from(event.target.files || []);
    if (event.target) event.target.value = "";
    if (!files.length) return;
    setUploading(true);
    try {
      const { data } = await fileAPI.uploadMany(files);
      const urls = (data?.files || []).map((f) => f.url).filter(Boolean);
      const nextGallery = [...gallery, ...urls];
      const { data: updated } = await vendorAPI.updateProfile({ portfolio_images: nextGallery });
      setProfile((prev) => ({ ...(prev || {}), ...(updated || {}), portfolio_images: nextGallery }));
      toast.success(urls.length === 1 ? "Photo added to your shop" : `${urls.length} photos added to your shop`);
    } catch (err) {
      toast.error(apiError(err, "The photos could not be added"));
    } finally {
      setUploading(false);
    }
  };

  const steps = useMemo(() => {
    const visible = mine.filter((i) => i.visible_to_network).length;
    const withPhoto = mine.filter((i) => i.visible_to_network && i.images?.length);
    return [
      // ── Vital information: cannot be dismissed, cannot be skipped ─────────
      {
        id: "shelf-photo",
        vital: true,
        done: withPhoto.length > 0,
        title: "Photograph what you sell",
        body: "A listing with a photo gets looked at. One without gets scrolled past — buyers decide from the picture before they read the price.",
        to: "/stock?new=1",
        cta: visible > 0 ? "Add a photo to a listing" : "Add your first item",
        photo: "stock",
      },
      {
        id: "shop-face",
        vital: true,
        done: gallery.length > 0,
        title: "Put a face on the shop",
        body: "Photos of the stall, the store or the stock. Every buyer asks what it looks like before they ask what it costs.",
        to: `/@${vendor?.vendor_handle}?edit=1`,
        cta: "Add shop photos",
        photo: "gallery",
      },
      {
        id: "description",
        vital: true,
        done: Boolean((vendor?.business_description || profile?.bio || "").trim()),
        title: "Describe the business in a sentence",
        body: "What you sell, who you sell it to, and where you are. This is the text a buyer reads before calling.",
        to: `/@${vendor?.vendor_handle}?edit=1`,
        cta: "Write it",
      },
      {
        id: "categories",
        vital: true,
        done: (vendor?.business_categories?.length || 0) > 0,
        title: "Say what you trade",
        body: "Categories are how the network matches you with suppliers and buyers.",
        to: `/@${vendor?.vendor_handle}?edit=1`,
        cta: "Choose categories",
      },
      // ── The trading loop: real work, but dismissible ──────────────────────
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
  }, [vendor, mine, connections, movements, profile, gallery]);

  const done = steps.filter((s) => s.done).length;
  const complete = done === steps.length;
  const vital = steps.filter((step) => step.vital);
  const vitalDone = vital.filter((step) => step.done).length;
  const vitalComplete = vitalDone === vital.length;

  useEffect(() => {
    if (complete && vendor?.vendor_handle) {
      try {
        localStorage.setItem(KEY(vendor.vendor_handle), "1");
      } catch {
        /* storage is not available — the checklist simply returns next visit */
      }
    }
  }, [complete, vendor]);

  // The vital half is hard-coded and cannot be dismissed. Someone who presses
  // the × on their first visit still sees the shop-photo task on every entry
  // until the shop has a face, a photo on the shelf, a sentence and a category.
  // Only once that is true does dismissal mean what it usually means.
  if (complete) return null;
  if (dismissed && vitalComplete) return null;
  const shown = dismissed ? vital : steps;
  const shownDone = dismissed ? vitalDone : done;

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
      {vitalComplete && (
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss setup checklist"
          className="absolute top-4 right-4 w-7 h-7 grid place-items-center rounded-lg text-ink-4 hover:text-ink-1 hover:bg-surface-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
        >
          <X size={15} aria-hidden="true" />
        </button>
      )}

      <div className="flex flex-wrap items-center gap-3 pr-8">
        <h2 id="setup-heading" className="text-base font-bold text-ink-1 tracking-tight">
          {vitalComplete ? "Get trading" : "Your shop is missing its details"}
        </h2>
        <span className="text-2xs font-bold text-ink-3 tabular-nums">
          {shownDone} of {shown.length}
        </span>
        <div className="h-1.5 flex-1 min-w-[6rem] max-w-[14rem] rounded-full bg-surface-3 overflow-hidden" role="progressbar" aria-valuenow={shownDone} aria-valuemin={0} aria-valuemax={shown.length}>
          <div className="h-full rounded-full bg-brand-500 transition-[width] duration-3 ease-out" style={{ width: `${(shownDone / shown.length) * 100}%` }} />
        </div>
      </div>

      <ol className="mt-3 grid sm:grid-cols-2 gap-x-6">
        {shown.filter((step) => !step.done).map((step) => (
          <li key={step.id} className="flex items-start gap-3 border-t border-edge-1 py-3">
            <Circle size={15} className="mt-0.5 shrink-0 text-ink-4" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-ink-1">{step.title}</p>
              <p className="text-micro text-ink-3 mt-0.5 leading-relaxed">{step.body}</p>
              {step.photo === "gallery" ? (
                // Same screen, one tap: opening the picker here is the whole
                // point of asking. A task that only links away is a task people
                // leave and forget.
                <>
                  <input
                    ref={galleryRef}
                    type="file"
                    accept="image/*"
                    multiple
                    capture={undefined}
                    className="hidden"
                    aria-label="Choose shop photos from your gallery"
                    onChange={addShopPhotos}
                  />
                  <button
                    type="button"
                    onClick={() => galleryRef.current?.click()}
                    disabled={uploading}
                    className="mt-1.5 inline-flex items-center gap-1 text-micro font-bold text-brand-700 dark:text-brand-400 hover:underline underline-offset-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-60 cursor-pointer"
                  >
                    {uploading ? "Adding photos…" : step.cta}
                    <ArrowRight size={12} aria-hidden="true" />
                  </button>
                </>
              ) : (
                <Link
                  to={step.to}
                  className="mt-1.5 inline-flex items-center gap-1 text-micro font-bold text-brand-700 dark:text-brand-400 hover:underline underline-offset-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                >
                  {step.cta}
                  <ArrowRight size={12} aria-hidden="true" />
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
