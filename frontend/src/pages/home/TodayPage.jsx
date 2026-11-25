import { useEffect, useMemo, useState } from "react";
import TodayView from "@/components/home/TodayView";
import { useAuthStore } from "@/stores/authStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useOutsideStore } from "@/stores/outsideStore";
import { useStockStore } from "@/stores/stockStore";
import { spottedDealAPI } from "@/lib/api";
import { useOffice } from "@/hooks/useOffice";
import { rankFor } from "@/config/identity";
import { regionFromPlace } from "@/config/regions";
import { parseApiDate } from "@/lib/formatters";

/**
 * Today's container. Each read answers one question on the command centre:
 *
 *   the session + identity  who this is and what they can do
 *   dated feed              what can be joined where they are
 *   activity                is anything waiting on a reply
 *   stock + movements       what their own page and trades look like
 *   office                  which home office they belong to
 *
 * The page used to make one profile request and one connections request for a
 * setup meter, then load statuses, radar counts, shelves, a newsletter and a
 * storefront. Every one of those was real; none of them was the answer to
 * "what is happening for me today?".
 */
export default function TodayPage() {
  const vendor = useAuthStore((s) => s.vendor);
  const identity = useIdentityStore();
  const loadIdentity = useIdentityStore((s) => s.load);

  const items = useOutsideStore((s) => s.items);
  const loadFeed = useOutsideStore((s) => s.loadFeed);
  const location = useOutsideStore((s) => s.location);
  const loadLocation = useOutsideStore((s) => s.loadLocation);
  const activity = useOutsideStore((s) => s.activity);
  const loadActivity = useOutsideStore((s) => s.loadActivity);

  const mine = useStockStore((s) => s.mine);
  const fetchMine = useStockStore((s) => s.fetchMine);
  const movements = useStockStore((s) => s.movements);
  const fetchMovements = useStockStore((s) => s.fetchMovements);

  const { office } = useOffice();
  const [deals, setDeals] = useState([]);

  useEffect(() => {
    loadIdentity();
  }, [loadIdentity]);

  useEffect(() => {
    if (!location) loadLocation();
    // Home shows three shelves, so it reads the local feed once and slices it
    // three ways. Regions still owns deep browsing; this is a page of the feed,
    // not a second copy of it.
    loadFeed();
    loadActivity();
    fetchMine().catch(() => {});
    fetchMovements().catch(() => {});
  }, [loadFeed, loadLocation, loadActivity, fetchMine, fetchMovements, location]);

  const region = useMemo(
    () => regionFromPlace(vendor?.physical_location || location?.label),
    [vendor?.physical_location, location?.label],
  );

  // Deals arrive from their own endpoint, so a failed deals call must not take
  // the whole Home page down with it. It degrades to no rail.
  useEffect(() => {
    if (!region?.slug) { setDeals([]); return; }
    let live = true;
    spottedDealAPI
      .list(region.slug)
      .then(({ data }) => { if (live) setDeals(Array.isArray(data) ? data : data?.items || []); })
      .catch(() => { if (live) setDeals([]); });
    return () => { live = false; };
  }, [region?.slug]);

  // Step 6: goods, services and rentals within reach, nearest first. Dated
  // rounds belong to their own shelf, so they are excluded here rather than
  // appearing twice on one screen.
  const nearby = useMemo(() => {
    const TRADE = new Set(["listing", "available", "service", "provider", "rental"]);
    const seen = new Set();
    return items
      .filter((item) => TRADE.has(item.kind))
      .filter((item) => {
        const key = `${item.kind}:${item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9))
      .slice(0, 6);
  }, [items]);

  const happening = useMemo(() => {
    if (!region) return [];
    const names = [region.hub, region.name, ...region.aliases].map((value) => value.toLowerCase());
    const cutoff = Date.now() - 12 * 60 * 60 * 1000;
    return items
      .filter((item) => item.kind === "scheduled" || item.kind === "event")
      .filter((item) => {
        const text = `${item.location || ""} ${item.area_name || ""}`.toLowerCase();
        return names.some((name) => text.includes(name));
      })
      .filter((item) => {
        const start = parseApiDate(item.starts_at);
        return Boolean(start) && start.getTime() >= cutoff;
      })
      .sort((a, b) => (parseApiDate(a.starts_at)?.getTime() || 0) - (parseApiDate(b.starts_at)?.getTime() || 0))
      .slice(0, 8);
  }, [items, region]);

  // Community activity: what the neighbourhood is saying and asking, as
  // opposed to what it is selling or when it meets. These kinds are the ones
  // no other Home shelf claims, so the same feed read serves four sections
  // without a second request.
  const community = useMemo(() => {
    const TALK = new Set(["post", "community", "wanted", "opportunity"]);
    const seen = new Set();
    return items
      .filter((item) => TALK.has(item.kind))
      .filter((item) => {
        const key = `${item.kind}:${item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => {
        const at = parseApiDate(a.created_at)?.getTime() || 0;
        const bt = parseApiDate(b.created_at)?.getTime() || 0;
        return bt - at;
      })
      .slice(0, 4);
  }, [items]);

  const rank = rankFor({ vendor, identity });

  const unreadNotifications = (activity?.groups || []).reduce(
    (total, group) => total + group.items.filter((item) => !item.is_read).length,
    0,
  );
  const waitingTrades = movements.filter((movement) =>
    ["pending", "requested", "confirmed"].includes(movement.status),
  ).length;
  const unread = unreadNotifications + (activity?.counts?.rooms_active_today || 0) + waitingTrades;

  const name = vendor?.business_name || vendor?.vendor_handle || "there";
  const firstName = name.split(" ")[0];

  return (
    <TodayView
      name={name}
      firstName={firstName}
      rank={rank}
      region={region}
      happening={happening}
      nearby={nearby}
      deals={deals}
      community={community}
      unread={unread}
      institution={
        office
          ? {
              name: office.name,
              line: `${office.my_role || "Member"}${office.area ? ` · ${office.area}` : ""}`,
            }
          : null
      }
      page={{
        published: Boolean(vendor?.vendor_handle) && identity.intent !== "explore",
        url: vendor?.vendor_handle ? `/p/${vendor.vendor_handle}` : null,
        href: vendor?.vendor_handle ? `/p/${vendor.vendor_handle}` : null,
        counts: {
          offers: mine.length,
          trades: vendor?.movements_completed || 0,
          verified: rank.level >= 5 || Boolean(vendor?.is_verified),
        },
      }}
    />
  );
}
