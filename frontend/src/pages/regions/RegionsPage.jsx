import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import RegionsView from "@/components/regions/RegionsView";
import { REGIONS, regionFromPlace } from "@/config/regions";

/**
 * Regions index. The country filter and the search are URL state, so a link to
 * "Uganda" or to "Kisumu" can be shared and the back button restores the list.
 */
export default function RegionsPage() {
  const [params, setParams] = useSearchParams();
  const country = params.get("country") || "";
  const initialSearch = params.get("q") || params.get("search") || "";
  const [search, setSearch] = useState(initialSearch);

  function update(patch) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  }

  const regions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return REGIONS;
    const byPlace = regionFromPlace(needle);
    return REGIONS.filter((region) => {
      if (region === byPlace) return true;
      return [region.name, region.hub, region.summary, ...region.knownFor, ...region.aliases]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [search]);

  return (
    <RegionsView
      country={country}
      onCountry={(code) => update({ country: code })}
      regions={regions}
      search={search}
      onSearch={(value) => {
        setSearch(value);
        update({ q: value });
      }}
    />
  );
}
