import { useEffect, useMemo, useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useStockStore } from "@/stores/stockStore";
import { vendorAPI } from "@/lib/api";

/**
 * ONE READING OF "HOW FAR ALONG IS THE SHOP".
 *
 * The setup checklist, the Home header and the Home action centre all need the
 * same six steps and the same done count. They used to be computed inside the
 * checklist alone; this hook is that computation, moved out unchanged, so every
 * surface agrees with every other one.
 *
 * Four vital steps (photo on the shelf, shop photos, description, categories)
 * and two trading steps (a supplier connection, one completed movement).
 */
export function useSetupProgress() {
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
  const total = steps.length;
  const vital = steps.filter((step) => step.vital);
  const vitalDone = vital.filter((step) => step.done).length;

  return {
    vendor,
    profile,
    setProfile,
    gallery,
    steps,
    vital,
    done,
    total,
    complete: done === total,
    vitalDone,
    vitalTotal: vital.length,
    vitalComplete: vitalDone === vital.length,
    loaded: profile !== null,
  };
}
