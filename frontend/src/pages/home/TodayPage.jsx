import { useEffect, useMemo } from "react";
import TodayView from "@/components/home/TodayView";
import { useAuthStore } from "@/stores/authStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useOutsideStore } from "@/stores/outsideStore";
import { useStockStore } from "@/stores/stockStore";
import { useOffice } from "@/hooks/useOffice";
import { rankFor } from "@/config/identity";
import { regionFromPlace } from "@/config/regions";

/**
 * Today's container. It does exactly three reads:
 *
 *   the session profile     who this is
 *   the identity record     why they joined and what they can do
 *   the local feed          what is happening where they are
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
  const status = useOutsideStore((s) => s.status);
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

  useEffect(() => {
    loadIdentity();
  }, [loadIdentity]);

  useEffect(() => {
    if (!location) loadLocation();
    loadFeed({});
    loadActivity();
    fetchMine().catch(() => {});
    fetchMovements().catch(() => {});
  }, [loadFeed, loadLocation, loadActivity, fetchMine, fetchMovements, location]);

  const region = useMemo(
    () => regionFromPlace(vendor?.physical_location || location?.label),
    [vendor?.physical_location, location?.label],
  );

  const pulse = useMemo(() => {
    if (!region) return [];
    const names = [region.hub, region.name, ...region.aliases].map((value) => value.toLowerCase());
    return items
      .filter((item) => {
        const text = `${item.location || ""} ${item.area_name || ""}`.toLowerCase();
        return names.some((name) => text.includes(name.toLowerCase()));
      })
      .slice(0, 3);
  }, [items, region]);

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
      identity={identity}
      region={region}
      pulse={pulse}
      pulseLoading={status === "loading"}
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
