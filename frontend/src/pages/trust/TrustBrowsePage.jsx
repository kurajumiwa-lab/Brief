import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { PageSpinner } from "@/components/ui/Spinner";
import { trustAPI, apiError } from "@/lib/api";
import { COUNTRIES, countryName, scoreText, STATUS_LABEL } from "./trustCore";

/**
 * SHOPS — real businesses with a physical branch, checked by Brief.
 * Open to everyone. Scores come from reviews; a shop with no reviews says so.
 */
export default function TrustBrowsePage() {
  const [country, setCountry] = useState("");
  const [branches, setBranches] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    setBranches(null);
    trustAPI.branches({ country: country || undefined, limit: 50 })
      .then(({ data }) => { if (live) { setBranches(data.branches); setError(null); } })
      .catch((err) => { if (live) setError(apiError(err, "Could not load shops")); });
    return () => { live = false; };
  }, [country]);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-16">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-ink-1">Shops you can trust</h1>
        <p className="text-sm text-ink-3">
          Real shops in Kenya, Ethiopia and Uganda. Brief checks each one before it appears here.
        </p>
        <p className="text-xs text-ink-3">
          <Link to="/trust/me" className="font-medium text-brand-700 underline">Add your shop or see your points</Link>
        </p>
      </header>

      <div role="group" aria-label="Choose a country" className="flex flex-wrap gap-2">
        {[{ code: "", name: "All" }, ...COUNTRIES].map((c) => (
          <button
            key={c.code || "all"}
            type="button"
            aria-pressed={country === c.code}
            onClick={() => setCountry(c.code)}
            className={`min-h-[40px] rounded-full border px-4 text-sm ${
              country === c.code ? "border-brand-600 bg-brand-50 font-semibold text-brand-700" : "border-edge-2 text-ink-2"
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!branches && !error && <PageSpinner />}
      {branches && branches.length === 0 && (
        <p className="text-sm text-ink-4">No checked shops in {country ? countryName(country) : "this area"} yet.</p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(branches || []).map((b) => (
          <Link key={b.id} to={`/trust/branches/${b.id}`} className="block focus:outline-none">
            <Card hover padding="p-4" className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="brand">{STATUS_LABEL.active}</Badge>
                <Badge variant="gray">{countryName(b.country_code)}</Badge>
              </div>
              <p className="text-sm font-semibold text-ink-1">{b.branch_name}</p>
              <p className="text-xs text-ink-3">{b.address_text}</p>
              <p className="text-xs text-ink-2">Rating: {scoreText(b.reputation)}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
