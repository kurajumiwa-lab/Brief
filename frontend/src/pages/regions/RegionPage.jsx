import { useEffect, useMemo, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import RegionView from "@/components/regions/RegionView";
import { REGION_BY_SLUG } from "@/config/regions";
import { useOutsideStore } from "@/stores/outsideStore";
import { useVendorStore } from "@/stores/vendorStore";

/**
 * One region.
 *
 * People come from the network directory; offers and needs come from the
 * outside feed. Both are filtered by the region's names on the client because
 * the API has no region parameter yet — the honest note at the bottom of the
 * page says so, and the filter is generous (name, hub and every alias) so a page
 * placed in "Kisumu, Nyanza" is not lost because it did not spell the region.
 */
export default function RegionPage() {
  const { slug } = useParams();
  const region = REGION_BY_SLUG[slug];
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "people";

  const items = useOutsideStore((s) => s.items);
  const status = useOutsideStore((s) => s.status);
  const loadFeed = useOutsideStore((s) => s.loadFeed);

  const network = useVendorStore((s) => s.network);
  const fetchNetwork = useVendorStore((s) => s.fetchNetwork);

  const [peopleLoading, setPeopleLoading] = useState(true);

  useEffect(() => {
    loadFeed({});
    fetchNetwork({})
      .catch(() => {})
      .finally(() => setPeopleLoading(false));
  }, [loadFeed, fetchNetwork]);

  const names = useMemo(
    () => (region ? [region.hub, region.name, ...region.aliases].map((value) => value.toLowerCase()) : []),
    [region],
  );

  const people = useMemo(() => {
    if (!region) return [];
    return network.filter((vendor) => {
      const text = `${vendor.physical_location || ""} ${vendor.business_description || ""}`.toLowerCase();
      return names.some((name) => text.includes(name));
    });
  }, [network, names, region]);

  const regionItems = useMemo(() => {
    if (!region) return [];
    return items.filter((item) => {
      const text = `${item.location || ""} ${item.area_name || ""}`.toLowerCase();
      return names.some((name) => text.includes(name));
    });
  }, [items, names, region]);

  if (!region) return <Navigate to="/regions" replace />;

  return (
    <RegionView
      region={region}
      tab={tab}
      onTab={(value) => {
        const next = new URLSearchParams(params);
        next.set("tab", value);
        setParams(next, { replace: true });
      }}
      people={people}
      items={regionItems}
      loading={(peopleLoading && tab === "people") || (status === "loading" && tab !== "people")}
    />
  );
}
