import { useEffect } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import ExplorePage from "@/pages/explore/ExplorePage";

/**
 * SMART CATEGORY ROUTES.
 *
 * /discover/services is a shareable address, not a redirect: the screen stays on
 * the path the notification or banner linked to, while the query parameters
 * carry the filters. The mapping below is the only place a route section becomes
 * feed state.
 */
const SECTIONS = {
  goods: { kind: "listing", intent: "offers", public_sale: "true" },
  services: { kind: "service" },
  rentals: { kind: "rental" },
  verified: { trust: "3", min_level: "3" },
  trending: { feed: "trending" },
};

export default function DiscoverSectionPage() {
  const { section } = useParams();
  const [, setParams] = useSearchParams();
  const location = useLocation();
  const preset = SECTIONS[section] || {};

  useEffect(() => {
    const next = new URLSearchParams(location.search);
    let changed = false;
    for (const [key, value] of Object.entries(preset)) {
      // The path supplies a default only; an explicit query wins.
      if (!next.get(key)) {
        next.set(key, value);
        changed = true;
      }
    }
    if (changed) setParams(next, { replace: true });
  }, [section]); // eslint-disable-line react-hooks/exhaustive-deps

  return <ExplorePage regionAware />;
}
