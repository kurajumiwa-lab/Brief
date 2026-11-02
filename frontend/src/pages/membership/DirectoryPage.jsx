import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import { fieldBase } from "@/components/ui/Input";
import { PageSpinner } from "@/components/ui/Spinner";
import { membershipAPI, apiError } from "@/lib/api";

/** MEMBER DIRECTORY — members who chose to be listed. Free for now. */
export default function DirectoryPage() {
  const [categories, setCategories] = useState([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    membershipAPI.categories().then(({ data }) => setCategories(data)).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      membershipAPI.directory({ q, category, verified_only: verifiedOnly || undefined })
        .then(({ data }) => { if (alive) { setResults(data); setError(null); } })
        .catch((err) => { if (alive) setError(apiError(err, "Could not search the directory")); });
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [q, category, verifiedOnly]);

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <p className="text-2xs uppercase tracking-wide text-ink-4">Membership</p>
        <h1 className="text-xl font-extrabold tracking-tight text-ink-1">Member directory</h1>
        <p className="text-sm text-ink-3 mt-0.5">
          Only members who chose to be listed appear here. <Link to="/membership" className="underline">Change your listing</Link>.
        </p>
      </div>

      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Search" placeholder="Name, class or description" value={q} onChange={(e) => setQ(e.target.value)} maxLength={120} />
          <div>
            <label htmlFor="dir-category" className="block text-2xs font-semibold text-ink-2 mb-1.5">Category</label>
            <select id="dir-category" className={`${fieldBase} h-10 px-3`} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-2xs text-ink-2">
          <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} />
          Verified members only
        </label>
      </Card>

      {error && <Card><p className="text-sm text-rose-600 dark:text-rose-400">{error}</p></Card>}
      {!results && !error && <PageSpinner label="Searching…" />}
      {results && results.length === 0 && (
        <Card><p className="text-sm text-ink-2">No listed members match. Try a different search.</p></Card>
      )}
      {results && results.length > 0 && (
        <ul className="space-y-2">
          {results.map((m) => (
            <li key={m.vendor_id}>
              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-ink-1 truncate">{m.display_name}</p>
                    <p className="text-2xs text-ink-3 truncate">@{m.handle}{m.professional_class ? ` · ${m.professional_class}` : ""}</p>
                    {m.bio && <p className="text-2xs text-ink-2 mt-1 leading-relaxed">{m.bio}</p>}
                    {m.contact_phone && <p className="text-2xs text-ink-2 mt-1">Phone: {m.contact_phone}</p>}
                  </div>
                  {m.verified && <Badge variant="brand">Verified</Badge>}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
